import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { creatorProfessionalFeatures, creatorProfiles, creatorStatusRuns, professionalGraphRuns } from "@/db/schema";
import type { Database } from "@/db/create-db";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { earnPoints } from "@/modules/rewards/ledger-service";

import {
  EMPTY_STATUS_INPUTS,
  STATUS_RULES_VERSION,
  evaluateStatus,
  statusInputsFromFeatures,
  type CriterionResult,
  type StatusInputs,
} from "./rules";
import { meetsTier, type CreatorStatusTier } from "./status";

/**
 * Creator Status evaluation (Stage 14). Runs after each Professional Graph
 * run, from that run's features only (reads the graph tables directly, so the
 * graph module doesn't depend on Status). Each graph run gets one status run
 * (re-evaluating the same run is a no-op; the hash covers the graph run, its
 * signal values and the rules version), and the one-off tier points are
 * granted in the same transaction.
 *
 * Creator-professional domain only. Never an input to underwriting, fraud,
 * lending or any limit.
 */
function hashStatusInputs(graphRunId: string, inputs: StatusInputs): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))));
  return createHash("sha256").update(`${STATUS_RULES_VERSION}|${graphRunId}|${canonical}`).digest("hex");
}

async function inputsForGraphRun(db: DbExecutor, graphRunId: string): Promise<StatusInputs> {
  const rows = await db
    .select({
      key: creatorProfessionalFeatures.featureKey,
      numeric: creatorProfessionalFeatures.valueNumeric,
      bool: creatorProfessionalFeatures.valueBoolean,
      source: creatorProfessionalFeatures.source,
    })
    .from(creatorProfessionalFeatures)
    .where(eq(creatorProfessionalFeatures.runId, graphRunId));
  return statusInputsFromFeatures(
    rows.map((r) => ({
      key: r.key,
      value: r.bool ?? (r.numeric === null ? null : Number(r.numeric)),
      source: r.source,
    })),
  );
}

export type StatusRefresh =
  | { ok: true; tier: CreatorStatusTier; runId: string; changed: boolean }
  | { ok: false; reason: "profile_inactive" | "graph_missing" };

/** Evaluates Creator Status from a graph run (normally the one just computed). Idempotent per inputs. */
export async function refreshCreatorStatus(
  db: Database,
  input: { creatorId: string; graphRunId: string; now?: Date },
): Promise<StatusRefresh> {
  return db.transaction((tx) => evaluateInTx(tx, input));
}

async function evaluateInTx(
  db: DbExecutor,
  input: { creatorId: string; graphRunId: string; now?: Date },
): Promise<StatusRefresh> {
  const now = input.now ?? new Date();
  // Serialises evaluations for one creator (and orders them with points holds).
  const [profile] = await db
    .select({ status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.id, input.creatorId))
    .for("no key update");
  if (profile?.status !== "completed") return { ok: false, reason: "profile_inactive" };
  const [graph] = await db
    .select({ id: professionalGraphRuns.id })
    .from(professionalGraphRuns)
    .where(and(eq(professionalGraphRuns.id, input.graphRunId), eq(professionalGraphRuns.creatorId, input.creatorId)));
  if (!graph) return { ok: false, reason: "graph_missing" };

  const inputs = await inputsForGraphRun(db, graph.id);
  const evaluation = evaluateStatus(inputs);
  const inputsHash = hashStatusInputs(graph.id, inputs);

  const [latest] = await db
    .select({ id: creatorStatusRuns.id, tier: creatorStatusRuns.tier, inputsHash: creatorStatusRuns.inputsHash })
    .from(creatorStatusRuns)
    .where(eq(creatorStatusRuns.creatorId, input.creatorId))
    .orderBy(desc(creatorStatusRuns.computedAt), desc(creatorStatusRuns.createdAt))
    .limit(1);
  if (latest?.inputsHash === inputsHash) return { ok: true, tier: latest.tier, runId: latest.id, changed: false };

  const [run] = await db
    .insert(creatorStatusRuns)
    .values({
      creatorId: input.creatorId,
      graphRunId: graph.id,
      rulesVersion: STATUS_RULES_VERSION,
      tier: evaluation.tier,
      criteria: evaluation.criteria,
      inputsHash,
      computedAt: now,
    })
    .returning({ id: creatorStatusRuns.id });
  if (!run) throw new Error("status run insert returned no row");
  const changed = latest?.tier !== evaluation.tier;
  await recordAuditEvent(db, {
    actorType: "system",
    eventType: "creator_status.computed",
    entityType: "creator_profile",
    entityId: input.creatorId,
    metadata: { tier: evaluation.tier, rules_version: STATUS_RULES_VERSION, changed },
  });
  // One-off membership points for reaching a tier (never clawed back if Status later drops).
  if (meetsTier(evaluation.tier, "onyx")) await earnPoints(db, { creatorId: input.creatorId, rule: "tier_onyx", now });
  if (meetsTier(evaluation.tier, "icon")) await earnPoints(db, { creatorId: input.creatorId, rule: "tier_icon", now });
  return { ok: true, tier: evaluation.tier, runId: run.id, changed };
}

export interface CreatorStatusView {
  tier: CreatorStatusTier;
  rulesVersion: string;
  /** Null until signals have been computed (everyone starts as Member). */
  computedAt: Date | null;
  basis: "signals" | "no_signals";
  criteria: CriterionResult[];
}

/** The creator's current Creator Status: the latest evaluation, or Member with nothing measured yet. */
export async function getCreatorStatus(db: DbExecutor, creatorId: string): Promise<CreatorStatusView> {
  const [run] = await db
    .select()
    .from(creatorStatusRuns)
    .where(eq(creatorStatusRuns.creatorId, creatorId))
    .orderBy(desc(creatorStatusRuns.computedAt), desc(creatorStatusRuns.createdAt))
    .limit(1);
  if (!run) {
    return {
      tier: "member",
      rulesVersion: STATUS_RULES_VERSION,
      computedAt: null,
      basis: "no_signals",
      criteria: evaluateStatus(EMPTY_STATUS_INPUTS).criteria,
    };
  }
  return {
    tier: run.tier,
    rulesVersion: run.rulesVersion,
    computedAt: run.computedAt,
    basis: "signals",
    criteria: run.criteria,
  };
}

/** Just the tier (for gating Access). */
export async function currentTier(db: DbExecutor, creatorId: string): Promise<CreatorStatusTier> {
  return (await getCreatorStatus(db, creatorId)).tier;
}
