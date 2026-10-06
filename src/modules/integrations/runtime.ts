import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { providerCallStats, providerRuntime } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import { hourBucket, nextCircuit, type CircuitPolicy, CIRCUIT_POLICY } from "./domain";

export type CallOutcome = "success" | "failure" | "rejection";

export interface CallRecord {
  configId: string;
  configKey: string;
  kind: string;
  operation: string;
  outcome: CallOutcome;
  durationMs: number;
  /** When the call started: a success that began before the circuit opened doesn't close it. */
  startedAt: Date;
  now: Date;
}

/**
 * Claims the single probe call for a cooled-down circuit (compare-and-set, so
 * only one request on one instance gets it). Returns false if someone else
 * already holds the probe.
 */
export async function claimProbe(
  db: DbExecutor,
  configId: string,
  now: Date,
  policy: CircuitPolicy = CIRCUIT_POLICY,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - policy.cooldownMs);
  const rows = await db
    .update(providerRuntime)
    .set({ circuitState: "half_open", openedAt: now })
    .where(
      and(
        eq(providerRuntime.configId, configId),
        inArray(providerRuntime.circuitState, ["open", "half_open"]),
        lte(providerRuntime.openedAt, cutoff),
      ),
    )
    .returning({ configId: providerRuntime.configId });
  return rows.length > 0;
}

/**
 * Records one provider call: an hourly stat row (counts and time only) and,
 * for successes/failures, the circuit-breaker transition shared by every app
 * instance. Returns the circuit change, if any, so the caller can refresh
 * routing at once.
 */
export async function recordCallOutcome(
  db: DbExecutor,
  call: CallRecord,
  policy: CircuitPolicy = CIRCUIT_POLICY,
): Promise<"opened" | "closed" | null> {
  const inc = (o: CallOutcome) => (call.outcome === o ? 1 : 0);
  await db
    .insert(providerCallStats)
    .values({
      configId: call.configId,
      bucket: hourBucket(call.now),
      operation: call.operation,
      successes: inc("success"),
      failures: inc("failure"),
      rejections: inc("rejection"),
      totalDurationMs: Math.max(0, Math.round(call.durationMs)),
    })
    .onConflictDoUpdate({
      target: [providerCallStats.configId, providerCallStats.bucket, providerCallStats.operation],
      set: {
        successes: sql`${providerCallStats.successes} + excluded.successes`,
        failures: sql`${providerCallStats.failures} + excluded.failures`,
        rejections: sql`${providerCallStats.rejections} + excluded.rejections`,
        totalDurationMs: sql`${providerCallStats.totalDurationMs} + excluded.total_duration_ms`,
      },
    });

  if (call.outcome === "rejection") return null;
  if (call.outcome === "success") {
    // Locks and writes only when something needs resetting, so healthy traffic costs one stat upsert.
    const reset = await db.execute<{ previous: string }>(sql`
      with old as (
        select circuit_state from ops.provider_runtime
        where config_id = ${call.configId} and (circuit_state <> 'closed' or consecutive_failures > 0)
        for update
      )
      update ops.provider_runtime r
      set circuit_state = 'closed', consecutive_failures = 0, opened_at = null
      from old
      where r.config_id = ${call.configId} and (r.circuit_state <> 'closed' or r.consecutive_failures > 0)
        and (r.opened_at is null or r.opened_at <= ${call.startedAt.toISOString()}::timestamptz)
      returning old.circuit_state as previous`);
    const wasOpen = reset.some((r) => r.previous !== "closed");
    if (wasOpen) await auditCircuit(db, call, "closed");
    return wasOpen ? "closed" : null;
  }

  return db.transaction(async (tx) => {
    await tx.insert(providerRuntime).values({ configId: call.configId }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(providerRuntime)
      .where(eq(providerRuntime.configId, call.configId))
      .for("update");
    const before = {
      state: row!.circuitState,
      consecutiveFailures: row!.consecutiveFailures,
      openedAt: row!.openedAt,
    };
    const after = nextCircuit(before, "failure", call.now, policy);
    await tx
      .update(providerRuntime)
      .set({
        circuitState: after.state,
        consecutiveFailures: after.consecutiveFailures,
        openedAt: after.openedAt,
        lastFailureAt: call.now,
      })
      .where(eq(providerRuntime.configId, call.configId));
    const opened = before.state === "closed" && after.state === "open";
    if (opened) await auditCircuit(tx, call, "opened");
    return opened ? "opened" : null;
  });
}

async function auditCircuit(db: DbExecutor, call: CallRecord, change: "opened" | "closed") {
  await recordAuditEvent(db, {
    actorType: "system",
    eventType: `integrations.circuit_${change}`,
    entityType: "provider_config",
    entityId: call.configId,
    metadata: { kind: call.kind, config_key: call.configKey, operation: call.operation },
  });
}
