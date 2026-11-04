import { createHash } from "node:crypto";

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  creditApplications,
  fraudChecks,
  fraudFlags,
  underwritingInputs,
  underwritingResults,
  underwritingRuns,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { recordEvent } from "@/modules/analytics";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { getFinancialCapacity } from "@/modules/financial-eligibility/application-service";
import {
  evaluateFraud,
  FRAUD_INPUT_KEYS,
  FRAUD_RULES_VERSION,
  type FraudInputs,
  type FraudResult,
} from "@/modules/fraud/rules";
import { getLatestProfessionalGraph } from "@/modules/professional-graph/graph-service";

import { buildFraudInputs } from "./fraud-inputs";
import {
  PROFESSIONAL_INPUTS,
  UNDERWRITING_MODEL_VERSION,
  applyFraudLayer,
  underwrite,
  type FeatureSnapshot,
  type ModelResult,
} from "./model";

/**
 * Underwriting orchestration. Freezes a feature snapshot (financial inputs
 * from the `fin` domain + creator-professional signals the creator has
 * allowed), scores it with both models and stores everything needed to
 * reconstruct the run. Lives in the regulated domain; erased with the check.
 */

export { PROFESSIONAL_INPUTS };

type Origin = "financial" | "professional" | "application";

const canonical = (o: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );

/** Identity of a run's inputs: the model snapshot plus the fraud layer's inputs. */
export function hashRunInputs(snapshot: FeatureSnapshot, fraud: FraudInputs): string {
  return createHash("sha256")
    .update(`${UNDERWRITING_MODEL_VERSION}|${FRAUD_RULES_VERSION}|${canonical(snapshot)}|${canonical({ ...fraud })}`)
    .digest("hex");
}

/** Scores a frozen snapshot: both models, then the separate fraud layer. Pure. */
export function decide(snapshot: FeatureSnapshot, fraudInputs: FraudInputs) {
  const fraud = evaluateFraud(fraudInputs);
  return { ...applyFraudLayer(underwrite(snapshot), fraud), fraud };
}

async function buildSnapshot(db: DbExecutor, input: { userId: string; applicationId: string; now: Date }) {
  const [app] = await db
    .select()
    .from(creditApplications)
    .where(and(eq(creditApplications.id, input.applicationId), eq(creditApplications.userId, input.userId)))
    .limit(1);
  if (!app || (app.status !== "inputs_ready" && app.status !== "submitted")) return null;
  const capacity = await getFinancialCapacity(db, { userId: input.userId, applicationId: app.id });
  if (!capacity) return null;

  const snapshot: FeatureSnapshot = {};
  const origins: Record<string, Origin> = {};
  for (const f of capacity.features) {
    snapshot[f.key] = f.value;
    origins[f.key] = "financial";
  }
  snapshot.requested_amount = app.requestedAmount;
  origins.requested_amount = "application";

  // Creator signals are used only while the creator has professional analytics on.
  let professionalRunId: string | null = null;
  let graphValues: FeatureSnapshot | null = null;
  if (await hasValidConsent(db, input.userId, CONSENT_KEYS.professionalAnalytics, input.now)) {
    const graph = await getLatestProfessionalGraph(db, app.creatorId);
    if (graph) {
      professionalRunId = graph.runId;
      graphValues = Object.fromEntries(graph.features.map((f) => [f.key, f.value ?? null]));
      for (const key of PROFESSIONAL_INPUTS) {
        snapshot[key] = graphValues[key] ?? null;
        origins[key] = "professional";
      }
    }
  }
  const fraudInputs = await buildFraudInputs(db, { app, snapshot, graph: graphValues, now: input.now });
  return { app, snapshot, origins, fraudInputs, financialRunId: capacity.runId, professionalRunId };
}

export type UnderwritingRunResult = {
  runId: string;
  reused: boolean;
  traditional: ModelResult;
  creatorEnhanced: ModelResult;
  fraud: FraudResult;
} | null;

/** Scores the check with both models. Identical inputs reuse the stored run. Returns null if inputs aren't ready. */
export async function runUnderwriting(
  db: Database,
  input: { userId: string; applicationId: string; now?: Date },
): Promise<UnderwritingRunResult> {
  const now = input.now ?? new Date();
  const built = await buildSnapshot(db, { ...input, now });
  if (!built) return null;
  const inputsHash = hashRunInputs(built.snapshot, built.fraudInputs);
  const result = decide(built.snapshot, built.fraudInputs);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: underwritingRuns.id })
      .from(underwritingRuns)
      .where(
        and(
          eq(underwritingRuns.applicationId, built.app.id),
          eq(underwritingRuns.modelVersion, UNDERWRITING_MODEL_VERSION),
          eq(underwritingRuns.inputsHash, inputsHash),
        ),
      )
      .limit(1);
    if (existing) return { runId: existing.id, reused: true, ...result };
    // Funnel measurement only: no scores, grades, amounts or outcomes leave the regulated domain.
    await recordEvent(tx, { event: "underwriting_started", userId: input.userId, now });

    const [run] = await tx
      .insert(underwritingRuns)
      .values({
        applicationId: built.app.id,
        modelVersion: UNDERWRITING_MODEL_VERSION,
        inputsHash,
        financialRunId: built.financialRunId,
        professionalRunId: built.professionalRunId,
        computedAt: now,
      })
      .returning({ id: underwritingRuns.id });
    await tx.insert(underwritingInputs).values(
      Object.entries(built.snapshot).map(([key, value]) => ({
        runId: run!.id,
        featureKey: key,
        origin: built.origins[key] ?? "financial",
        valueNumeric:
          typeof value === "number" ? String(value) : typeof value === "boolean" ? (value ? "1" : "0") : null,
        valueText: typeof value === "string" ? value : null,
      })),
    );
    await tx.insert(underwritingResults).values(
      [result.traditional, result.creatorEnhanced].map((r) => ({
        runId: run!.id,
        model: r.model,
        score: r.score === null ? null : String(r.score),
        grade: r.grade,
        completeness: String(r.completeness),
        confidence: r.confidence,
        outcome: r.outcome,
        incomeBasis: r.incomeBasis?.monthly ?? null,
        incomeBasisSource: r.incomeBasis?.source ?? null,
        recommendedExposure: r.recommendedExposure,
        maxRecommendedExposure: r.maxRecommendedExposure,
        recommendedTenorMonths: r.recommendedTenorMonths,
        components: r.components as Record<string, number | null>,
        reasonCodes: r.reasonCodes,
      })),
    );
    const [check] = await tx
      .insert(fraudChecks)
      .values({
        runId: run!.id,
        applicationId: built.app.id,
        rulesVersion: result.fraud.rulesVersion,
        outcome: result.fraud.outcome,
        highestSeverity: result.fraud.highestSeverity,
        inputs: { ...built.fraudInputs },
        checks: result.fraud.checks,
        computedAt: now,
      })
      .returning({ id: fraudChecks.id });
    if (result.fraud.flags.length) {
      await tx.insert(fraudFlags).values(
        result.fraud.flags.map((f) => ({
          checkId: check!.id,
          code: f.code,
          category: f.category,
          severity: f.severity,
          evidence: f.evidence,
        })),
      );
    }
    await recordAuditEvent(tx, {
      actorType: "system",
      eventType: "underwriting.completed",
      entityType: "credit_application",
      entityId: built.app.id,
      metadata: {
        model_version: UNDERWRITING_MODEL_VERSION,
        creator_signals: built.professionalRunId !== null,
        fraud_rules: result.fraud.rulesVersion,
        fraud_outcome: result.fraud.outcome,
        fraud_flags: result.fraud.flags.length,
      },
    });
    await recordEvent(tx, {
      event: "underwriting_completed",
      userId: input.userId,
      props: { model_version: UNDERWRITING_MODEL_VERSION },
      now,
    });
    return { runId: run!.id, reused: false, ...result };
  });
}

/** Whether a recommendation has been prepared for a check (creator-facing: no figures). */
export async function hasUnderwritingRun(db: DbExecutor, applicationId: string) {
  const rows = await db
    .select({ id: underwritingRuns.id })
    .from(underwritingRuns)
    .where(eq(underwritingRuns.applicationId, applicationId))
    .limit(1);
  return rows.length > 0;
}

function resultView(r: typeof underwritingResults.$inferSelect) {
  return {
    model: r.model,
    score: r.score === null ? null : Number(r.score),
    grade: r.grade,
    completeness: Number(r.completeness),
    confidence: r.confidence,
    outcome: r.outcome,
    incomeBasis: r.incomeBasis,
    incomeBasisSource: r.incomeBasisSource,
    recommendedExposure: r.recommendedExposure,
    maxRecommendedExposure: r.maxRecommendedExposure,
    recommendedTenorMonths: r.recommendedTenorMonths,
    components: r.components,
    reasonCodes: r.reasonCodes,
  };
}

/** Full run for staff review: both models, components, reason codes and the frozen inputs. */
export async function getUnderwritingRun(db: DbExecutor, runId: string) {
  const [run] = await db.select().from(underwritingRuns).where(eq(underwritingRuns.id, runId)).limit(1);
  if (!run) return null;
  const results = await db.select().from(underwritingResults).where(eq(underwritingResults.runId, run.id));
  const inputs = await db.select().from(underwritingInputs).where(eq(underwritingInputs.runId, run.id));
  const [check] = await db.select().from(fraudChecks).where(eq(fraudChecks.runId, run.id)).limit(1);
  const flags = check ? await db.select().from(fraudFlags).where(eq(fraudFlags.checkId, check.id)) : [];
  return {
    ...run,
    fraud: check
      ? {
          rulesVersion: check.rulesVersion,
          outcome: check.outcome,
          highestSeverity: check.highestSeverity,
          inputs: check.inputs,
          checks: check.checks,
          flags: flags.map((f) => ({ code: f.code, category: f.category, severity: f.severity, evidence: f.evidence })),
        }
      : null,
    traditional: results.find((r) => r.model === "traditional")
      ? resultView(results.find((r) => r.model === "traditional")!)
      : null,
    creatorEnhanced: results.find((r) => r.model === "creator_enhanced")
      ? resultView(results.find((r) => r.model === "creator_enhanced")!)
      : null,
    inputs: inputs
      .map((i) => ({
        key: i.featureKey,
        origin: i.origin,
        value: i.valueText ?? (i.valueNumeric === null ? null : Number(i.valueNumeric)),
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.key.localeCompare(b.key)),
  };
}

/** Recomputes a stored run from its frozen inputs and checks it reproduces exactly. */
export async function verifyUnderwritingReproducible(db: DbExecutor, runId: string) {
  const run = await getUnderwritingRun(db, runId);
  if (!run || !run.traditional || !run.creatorEnhanced || !run.fraud) return false;
  if (run.modelVersion !== UNDERWRITING_MODEL_VERSION || run.fraud.rulesVersion !== FRAUD_RULES_VERSION) return false;
  const snapshot: FeatureSnapshot = {};
  const BOOLEAN_KEYS = new Set(["follower_spike_detected"]);
  for (const i of run.inputs)
    snapshot[i.key] = BOOLEAN_KEYS.has(i.key) && typeof i.value === "number" ? i.value === 1 : i.value;
  const fraudInputs = Object.fromEntries(
    FRAUD_INPUT_KEYS.map((k) => [k, run.fraud!.inputs[k] ?? null]),
  ) as unknown as FraudInputs;
  if (hashRunInputs(snapshot, fraudInputs) !== run.inputsHash) return false;
  const again = decide(snapshot, fraudInputs);
  const flagKey = (f: { code: string; severity: string }) => `${f.code}:${f.severity}`;
  return (
    again.traditional.score === run.traditional.score &&
    again.creatorEnhanced.score === run.creatorEnhanced.score &&
    again.traditional.recommendedExposure === run.traditional.recommendedExposure &&
    again.creatorEnhanced.recommendedExposure === run.creatorEnhanced.recommendedExposure &&
    again.traditional.outcome === run.traditional.outcome &&
    again.creatorEnhanced.outcome === run.creatorEnhanced.outcome &&
    again.fraud.outcome === run.fraud.outcome &&
    JSON.stringify(again.fraud.checks) === JSON.stringify(run.fraud.checks) &&
    again.traditional.grade === run.traditional.grade &&
    again.creatorEnhanced.grade === run.creatorEnhanced.grade &&
    again.fraud.flags.map(flagKey).sort().join() === run.fraud.flags.map(flagKey).sort().join()
  );
}

/** Recent runs for the risk console (no applicant identity). */
export async function listUnderwritingRuns(db: DbExecutor, limit = 25) {
  const runs = await db
    .select({
      id: underwritingRuns.id,
      applicationId: underwritingRuns.applicationId,
      modelVersion: underwritingRuns.modelVersion,
      computedAt: underwritingRuns.computedAt,
      professionalRunId: underwritingRuns.professionalRunId,
    })
    .from(underwritingRuns)
    .orderBy(desc(underwritingRuns.computedAt), desc(underwritingRuns.createdAt))
    .limit(limit);
  if (!runs.length) return [];
  const results = await db
    .select()
    .from(underwritingResults)
    .where(
      inArray(
        underwritingResults.runId,
        runs.map((r) => r.id),
      ),
    );
  const checks = await db
    .select({ runId: fraudChecks.runId, outcome: fraudChecks.outcome, highestSeverity: fraudChecks.highestSeverity })
    .from(fraudChecks)
    .where(
      inArray(
        fraudChecks.runId,
        runs.map((r) => r.id),
      ),
    );
  return runs.map((r) => {
    const t = results.find((x) => x.runId === r.id && x.model === "traditional");
    const e = results.find((x) => x.runId === r.id && x.model === "creator_enhanced");
    return {
      ...r,
      creatorSignals: r.professionalRunId !== null,
      fraud: checks.find((c) => c.runId === r.id) ?? null,
      traditional: t ? { grade: t.grade, outcome: t.outcome, exposure: t.recommendedExposure } : null,
      creatorEnhanced: e ? { grade: e.grade, outcome: e.outcome, exposure: e.recommendedExposure } : null,
    };
  });
}

/** Model-comparison aggregates (CLAUDE.md §26 risk analytics). */
export async function underwritingComparisonStats(db: DbExecutor) {
  const [runs] = await db.select({ n: count() }).from(underwritingRuns);
  const rows = await db
    .select({
      model: underwritingResults.model,
      n: count(),
      recommended: sql<number>`count(*) filter (where ${underwritingResults.outcome} = 'recommend')`.mapWith(Number),
      avgScore: sql<number | null>`avg(${underwritingResults.score})`.mapWith((v) =>
        v === null ? null : Math.round(Number(v) * 10) / 10,
      ),
      avgExposure: sql<number | null>`avg(${underwritingResults.recommendedExposure})`.mapWith((v) =>
        v === null ? null : Math.round(Number(v)),
      ),
    })
    .from(underwritingResults)
    .groupBy(underwritingResults.model);
  const fraud = await db
    .select({ outcome: fraudChecks.outcome, n: count() })
    .from(fraudChecks)
    .groupBy(fraudChecks.outcome);
  const flagsByCode = await db
    .select({ code: fraudFlags.code, severity: fraudFlags.severity, n: count() })
    .from(fraudFlags)
    .groupBy(fraudFlags.code, fraudFlags.severity);
  return {
    runs: runs?.n ?? 0,
    byModel: rows,
    fraud: Object.fromEntries(fraud.map((f) => [f.outcome, f.n])) as Partial<
      Record<"clear" | "watch" | "review", number>
    >,
    flagsByCode,
  };
}

export { eraseUnderwritingRuns } from "./erasure";
