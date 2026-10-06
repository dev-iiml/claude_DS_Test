import { desc, eq, max, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { simulatedLenderPolicies } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import {
  DEFAULT_SIMULATED_POLICY,
  simulatedPolicySchema,
  type SimulatedLenderPolicy,
} from "@/providers/lender/simulated-policy";

/**
 * Simulated partner-lender policy versions (Stage 12, user decision):
 * editable through maker-checker — one risk admin proposes, a different one
 * approves. Exactly one active version; every version is kept.
 */

export class LenderPolicyError extends Error {
  constructor(
    readonly code: "invalid" | "not_found" | "not_pending" | "self_approval",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "LenderPolicyError";
  }
}

export interface ActivePolicy {
  version: number;
  rules: SimulatedLenderPolicy;
}

export async function getActivePolicy(db: DbExecutor): Promise<ActivePolicy> {
  const [row] = await db
    .select({ version: simulatedLenderPolicies.version, rules: simulatedLenderPolicies.rules })
    .from(simulatedLenderPolicies)
    .where(eq(simulatedLenderPolicies.status, "active"))
    .limit(1);
  return row
    ? { version: row.version, rules: simulatedPolicySchema.parse(row.rules) }
    : { version: 1, rules: DEFAULT_SIMULATED_POLICY };
}

export async function getPolicyVersion(db: DbExecutor, version: number): Promise<SimulatedLenderPolicy | null> {
  const [row] = await db
    .select({ rules: simulatedLenderPolicies.rules })
    .from(simulatedLenderPolicies)
    .where(eq(simulatedLenderPolicies.version, version))
    .limit(1);
  return row ? simulatedPolicySchema.parse(row.rules) : null;
}

export async function listPolicies(db: DbExecutor) {
  return db.select().from(simulatedLenderPolicies).orderBy(desc(simulatedLenderPolicies.version));
}

/** Reference data: the default policy as v1, if no version exists yet. */
export async function publishDefaultLenderPolicy(db: DbExecutor, now = new Date()) {
  await db
    .insert(simulatedLenderPolicies)
    .values({ version: 1, status: "active", rules: DEFAULT_SIMULATED_POLICY, note: "Default", proposedAt: now })
    .onConflictDoNothing();
}

export async function proposePolicy(
  db: Database,
  input: { staffId: string; rules: unknown; note?: string | null; now?: Date },
) {
  const parsed = simulatedPolicySchema.safeParse(input.rules);
  if (!parsed.success) throw new LenderPolicyError("invalid", parsed.error.issues.map((i) => i.message).join("; "));
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ops.simulated_lender_policies in share row exclusive mode`);
    // v1 is always the default (what proposals fall back to), even if reference data wasn't published.
    await publishDefaultLenderPolicy(tx, now);
    const [{ v } = { v: 0 }] = await tx
      .select({ v: max(simulatedLenderPolicies.version) })
      .from(simulatedLenderPolicies);
    const [row] = await tx
      .insert(simulatedLenderPolicies)
      .values({
        version: (v ?? 0) + 1,
        status: "proposed",
        rules: parsed.data,
        note: input.note?.trim() || null,
        proposedBy: input.staffId,
        proposedAt: now,
      })
      .returning();
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "lending.policy_proposed",
      entityType: "simulated_lender_policy",
      entityId: row!.id,
      metadata: { version: row!.version },
    });
    return row!;
  });
}

export async function decidePolicy(
  db: Database,
  input: { staffId: string; policyId: string; approve: boolean; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(simulatedLenderPolicies)
      .where(eq(simulatedLenderPolicies.id, input.policyId))
      .for("update");
    if (!row) throw new LenderPolicyError("not_found");
    if (row.status !== "proposed") throw new LenderPolicyError("not_pending", "This version was already decided.");
    if (row.proposedBy === input.staffId)
      throw new LenderPolicyError("self_approval", "A different risk admin has to approve or reject this version.");
    const [active] = await tx
      .select({ version: simulatedLenderPolicies.version })
      .from(simulatedLenderPolicies)
      .where(eq(simulatedLenderPolicies.status, "active"))
      .for("update");
    if (input.approve && active && active.version > row.version)
      throw new LenderPolicyError(
        "not_pending",
        `A newer version (v${active.version}) is already active. Propose again from it.`,
      );
    if (input.approve) {
      await tx
        .update(simulatedLenderPolicies)
        .set({ status: "superseded" })
        .where(eq(simulatedLenderPolicies.status, "active"));
    }
    const [updated] = await tx
      .update(simulatedLenderPolicies)
      .set({ status: input.approve ? "active" : "rejected", decidedBy: input.staffId, decidedAt: now })
      .where(eq(simulatedLenderPolicies.id, row.id))
      .returning();
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: input.approve ? "lending.policy_approved" : "lending.policy_rejected",
      entityType: "simulated_lender_policy",
      entityId: row.id,
      metadata: { version: row.version },
    });
    return updated!;
  });
}
