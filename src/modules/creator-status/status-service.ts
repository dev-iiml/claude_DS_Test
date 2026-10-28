import { desc, eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { creatorProfessionalFeatures, creatorStatusRuns, professionalGraphRuns } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { grantDueMilestones } from "@/modules/rewards/points-service";

import { CREATOR_STATUS_RULES_VERSION, evaluateCreatorStatus, type StatusSignals, type TierChecklist } from "./rules";
import { DEFAULT_CREATOR_STATUS, type CreatorStatusTier } from "./status";

/**
 * Creator Status service (Stage 14). Status is recalculated from a stored
 * Professional Graph run and stored next to it; the tier grant (Creator
 * Points) happens in the same transaction, so a refresh is all-or-nothing.
 *
 * Status never reads financial data and nothing credit-related reads Status.
 */

async function signalsForRun(db: DbExecutor, graphRunId: string): Promise<StatusSignals> {
  const rows = await db
    .select({
      key: creatorProfessionalFeatures.featureKey,
      numeric: creatorProfessionalFeatures.valueNumeric,
      boolean: creatorProfessionalFeatures.valueBoolean,
      source: creatorProfessionalFeatures.source,
    })
    .from(creatorProfessionalFeatures)
    .where(eq(creatorProfessionalFeatures.runId, graphRunId));
  return Object.fromEntries(
    rows.map((r) => [r.key, { value: r.boolean ?? (r.numeric === null ? null : Number(r.numeric)), source: r.source }]),
  );
}

export interface StatusRefreshResult {
  statusRunId: string;
  tier: CreatorStatusTier;
  reused: boolean;
}

/**
 * Calculates Creator Status from a Professional Graph run (idempotent per run
 * and rules version) and grants any milestone points now due.
 */
export async function refreshCreatorStatus(
  db: Database,
  input: { creatorId: string; graphRunId: string; now?: Date },
): Promise<StatusRefreshResult | null> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: professionalGraphRuns.id, creatorId: professionalGraphRuns.creatorId })
      .from(professionalGraphRuns)
      .where(eq(professionalGraphRuns.id, input.graphRunId))
      .limit(1);
    if (!run || run.creatorId !== input.creatorId) return null;

    const evaluation = evaluateCreatorStatus(await signalsForRun(tx, run.id));
    const [inserted] = await tx
      .insert(creatorStatusRuns)
      .values({
        creatorId: input.creatorId,
        graphRunId: run.id,
        rulesVersion: evaluation.rulesVersion,
        tier: evaluation.tier,
        criteria: evaluation.checklists,
        computedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: creatorStatusRuns.id });

    let statusRunId = inserted?.id;
    if (!statusRunId) {
      const [existing] = await tx
        .select({ id: creatorStatusRuns.id })
        .from(creatorStatusRuns)
        .where(eq(creatorStatusRuns.graphRunId, run.id))
        .limit(1);
      statusRunId = existing!.id;
    } else {
      await recordAuditEvent(tx, {
        actorType: "system",
        eventType: "creator_status.calculated",
        entityType: "creator_profile",
        entityId: input.creatorId,
        metadata: { rules_version: CREATOR_STATUS_RULES_VERSION, tier: evaluation.tier },
      });
    }
    await grantDueMilestones(tx, { creatorId: input.creatorId, tier: evaluation.tier });
    return { statusRunId, tier: evaluation.tier, reused: !inserted };
  });
}

export interface CurrentCreatorStatus {
  tier: CreatorStatusTier;
  /** null when no status has been calculated (no signals yet, or they were erased). */
  rulesVersion: string | null;
  computedAt: Date | null;
  checklists: TierChecklist[];
}

/** The creator's current Creator Status: the latest calculation, or Member when there is none. Read-only. */
export async function getCurrentCreatorStatus(db: DbExecutor, creatorId: string): Promise<CurrentCreatorStatus> {
  const [run] = await db
    .select()
    .from(creatorStatusRuns)
    .where(eq(creatorStatusRuns.creatorId, creatorId))
    .orderBy(desc(creatorStatusRuns.computedAt), desc(creatorStatusRuns.createdAt))
    .limit(1);
  if (!run) return { tier: DEFAULT_CREATOR_STATUS, rulesVersion: null, computedAt: null, checklists: [] };
  return { tier: run.tier, rulesVersion: run.rulesVersion, computedAt: run.computedAt, checklists: run.criteria };
}
