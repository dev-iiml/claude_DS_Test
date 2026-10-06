import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  creatorProfessionalFeatures,
  creatorProfiles,
  creatorSocialAccounts,
  creatorSocialSnapshots,
  professionalGraphRuns,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";

import type { GraphRunTrigger } from "./domain";
import { ENGINE_VERSION, computeFeatures, type EngineInput, type FeatureKey, type FeatureResult } from "./engine";
import { hashInputs } from "./inputs-hash";

/** Builds the engine input from stored data. Snapshots ≤ asOf only, so reruns are reproducible. */
export async function loadEngineInput(db: DbExecutor, creatorId: string, asOf: string): Promise<EngineInput> {
  const [profile] = await db
    .select({ creatorSince: creatorProfiles.creatorSince })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.id, creatorId))
    .limit(1);

  const rows = await db
    .select()
    .from(creatorSocialAccounts)
    .where(
      and(eq(creatorSocialAccounts.creatorId, creatorId), ne(creatorSocialAccounts.connectionStatus, "disconnected")),
    );
  const declaredPlatforms = [...new Set(rows.filter((r) => r.declaredHandle !== null).map((r) => r.platform))];
  const connected = rows.filter((r) => r.connectionStatus === "connected");

  const snaps = connected.length
    ? await db
        .select()
        .from(creatorSocialSnapshots)
        .where(
          inArray(
            creatorSocialSnapshots.socialAccountId,
            connected.map((c) => c.id),
          ),
        )
        .orderBy(asc(creatorSocialSnapshots.capturedAt))
    : [];

  const asOfEnd = `${asOf}T23:59:59.999Z`;
  return {
    asOf: `${asOf}T00:00:00.000Z`,
    creatorSince: profile?.creatorSince ?? null,
    declaredPlatforms,
    accounts: connected.map((a) => ({
      platform: a.platform,
      handle: a.handle,
      declaredHandle: a.declaredHandle,
      accountCreatedAt: a.accountCreatedAt?.toISOString() ?? null,
      snapshots: snaps
        .filter((s) => s.socialAccountId === a.id && s.capturedAt.toISOString() <= asOfEnd)
        .map((s) => ({
          capturedAt: s.capturedAt.toISOString(),
          audience: s.followers ?? s.subscribers ?? null,
          engagementRate: s.engagementRate === null ? null : Number(s.engagementRate),
          postsCount: s.postsCount,
        })),
    })),
  };
}

export type GraphRunResult =
  | { ok: true; runId: string; reused: boolean; features: FeatureResult[] }
  | { ok: false; reason: "consent_required" | "profile_missing" | "profile_inactive" };

/**
 * Computes and stores the Professional Graph for a creator. Requires the
 * separate `professional_analytics` consent. Identical inputs reuse the
 * existing run (same id), which makes every stored run reproducible.
 */
export async function runProfessionalGraph(
  db: Database,
  input: { userId: string; creatorId: string; trigger: GraphRunTrigger; now?: Date },
): Promise<GraphRunResult> {
  const now = input.now ?? new Date();
  const [profile] = await db
    .select({ status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.id, input.creatorId))
    .limit(1);
  if (!profile) return { ok: false, reason: "profile_missing" };
  // A paused (or suspended) membership is not processed.
  if (profile.status !== "completed") return { ok: false, reason: "profile_inactive" };
  if (!(await hasValidConsent(db, input.userId, CONSENT_KEYS.professionalAnalytics, now))) {
    return { ok: false, reason: "consent_required" };
  }

  const asOf = now.toISOString().slice(0, 10);
  const engineInput = await loadEngineInput(db, input.creatorId, asOf);
  const inputsHash = hashInputs(engineInput);
  const features = computeFeatures(engineInput);
  const snapshotCount = engineInput.accounts.reduce((n, a) => n + a.snapshots.length, 0);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: professionalGraphRuns.id })
      .from(professionalGraphRuns)
      .where(
        and(
          eq(professionalGraphRuns.creatorId, input.creatorId),
          eq(professionalGraphRuns.engineVersion, ENGINE_VERSION),
          eq(professionalGraphRuns.inputsHash, inputsHash),
        ),
      )
      .limit(1);
    if (existing) return { ok: true as const, runId: existing.id, reused: true, features };

    const [run] = await tx
      .insert(professionalGraphRuns)
      .values({
        creatorId: input.creatorId,
        engineVersion: ENGINE_VERSION,
        inputsHash,
        snapshotCount,
        trigger: input.trigger,
        computedAt: now,
      })
      .returning({ id: professionalGraphRuns.id });
    if (!run) throw new Error("graph run insert returned no row");

    await tx.insert(creatorProfessionalFeatures).values(
      features.map((f) => ({
        runId: run.id,
        creatorId: input.creatorId,
        featureKey: f.key,
        featureVersion: f.version,
        valueNumeric: typeof f.value === "number" ? String(f.value) : null,
        valueBoolean: typeof f.value === "boolean" ? f.value : null,
        unit: f.unit,
        source: f.source,
        completeness: String(f.completeness),
        confidence: f.confidence,
        provenance: f.provenance,
        computedAt: now,
      })),
    );

    await recordAuditEvent(tx, {
      actorType: "system",
      eventType: "professional_graph.computed",
      entityType: "creator_profile",
      entityId: input.creatorId,
      metadata: {
        engine_version: ENGINE_VERSION,
        features: features.length,
        snapshots: snapshotCount,
        trigger: input.trigger,
      },
    });
    return { ok: true as const, runId: run.id, reused: false, features };
  });
}

export interface StoredFeature {
  key: FeatureKey;
  version: string;
  value: number | boolean | null;
  unit: string;
  source: string;
  completeness: number;
  confidence: string;
  provenance: Record<string, unknown>;
}

/** The latest run and its features, or null if none has been computed. */
export async function getLatestProfessionalGraph(db: DbExecutor, creatorId: string) {
  const [run] = await db
    .select()
    .from(professionalGraphRuns)
    .where(eq(professionalGraphRuns.creatorId, creatorId))
    .orderBy(desc(professionalGraphRuns.computedAt), desc(professionalGraphRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const rows = await db.select().from(creatorProfessionalFeatures).where(eq(creatorProfessionalFeatures.runId, run.id));
  const features: StoredFeature[] = rows.map((r) => ({
    key: r.featureKey as FeatureKey,
    version: r.featureVersion,
    value: r.valueBoolean ?? (r.valueNumeric === null ? null : Number(r.valueNumeric)),
    unit: r.unit,
    source: r.source,
    completeness: Number(r.completeness),
    confidence: r.confidence,
    provenance: r.provenance,
  }));
  return {
    runId: run.id,
    engineVersion: run.engineVersion,
    inputsHash: run.inputsHash,
    computedAt: run.computedAt,
    snapshotCount: run.snapshotCount,
    features,
  };
}

/** Recomputes a stored run from current data and checks it reproduces exactly (used by tests / audits). */
export async function verifyRunReproducible(db: DbExecutor, runId: string): Promise<boolean> {
  const [run] = await db.select().from(professionalGraphRuns).where(eq(professionalGraphRuns.id, runId)).limit(1);
  if (!run) return false;
  const input = await loadEngineInput(db, run.creatorId, run.computedAt.toISOString().slice(0, 10));
  return hashInputs(input) === run.inputsHash;
}

export async function hasConnectedAccounts(db: DbExecutor, creatorId: string) {
  const rows = await db
    .select({ id: creatorSocialAccounts.id })
    .from(creatorSocialAccounts)
    .where(
      and(
        eq(creatorSocialAccounts.creatorId, creatorId),
        eq(creatorSocialAccounts.connectionStatus, "connected"),
        isNotNull(creatorSocialAccounts.connectedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
