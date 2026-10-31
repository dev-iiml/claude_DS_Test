import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import { jobs } from "@/db/schema";
import type { Database } from "@/db";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import {
  DEFAULT_MAX_ATTEMPTS,
  JOB_SCHEDULES,
  STALE_LOCK_MS,
  describeJobError,
  retryDelayMs,
  scheduleWindowKey,
  type JobType,
} from "./domain";

/**
 * A small Postgres-backed job queue: no extra infrastructure, safe with
 * several workers (`FOR UPDATE SKIP LOCKED`), retries with backoff, and a
 * dead state for jobs that keep failing. Driven by a cron tick.
 */

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (ctx: {
  db: Database;
  now: Date;
  payload: JobRow["payload"];
}) => Promise<Record<string, number>>;
export type JobHandlers = Record<JobType, JobHandler>;

export async function enqueueJob(
  db: DbExecutor,
  input: {
    type: JobType;
    payload?: JobRow["payload"];
    dedupeKey?: string;
    runAfter?: Date;
    maxAttempts?: number;
    requestedBy?: string | null;
  },
): Promise<string | null> {
  const [row] = await db
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload ?? {},
      dedupeKey: input.dedupeKey ?? null,
      runAfter: input.runAfter ?? new Date(),
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      requestedBy: input.requestedBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

/** Enqueues each schedule once per window (overlapping ticks are harmless). */
export async function enqueueDueSchedules(db: DbExecutor, now: Date) {
  let enqueued = 0;
  for (const schedule of JOB_SCHEDULES) {
    const id = await enqueueJob(db, {
      type: schedule.type,
      dedupeKey: scheduleWindowKey(schedule, now),
      runAfter: now,
    });
    if (id) enqueued += 1;
  }
  return enqueued;
}

/** Jobs left `running` by a worker that died are queued again — or dead, if that was their last attempt. */
export async function requeueStaleJobs(db: DbExecutor, now: Date) {
  const rows = await db
    .update(jobs)
    .set({
      status: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then 'dead' else 'queued' end`,
      lockedAt: null,
      runAfter: now,
      lastError: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then 'Worker stopped before finishing' else ${jobs.lastError} end`,
      finishedAt: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then ${now.toISOString()}::timestamptz else null end`,
    })
    .where(and(eq(jobs.status, "running"), lte(jobs.lockedAt, new Date(now.getTime() - STALE_LOCK_MS))))
    .returning({ id: jobs.id });
  return rows.length;
}

export async function claimDueJobs(db: DbExecutor, now: Date, limit: number, onlyIds?: string[]): Promise<JobRow[]> {
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "queued"),
        lte(jobs.runAfter, now),
        onlyIds ? inArray(jobs.id, onlyIds.length ? onlyIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
      ),
    )
    .orderBy(jobs.runAfter)
    .limit(limit)
    .for("update", { skipLocked: true });
  return db
    .update(jobs)
    .set({ status: "running", lockedAt: now, attempts: sql`${jobs.attempts} + 1` })
    .where(inArray(jobs.id, due))
    .returning();
}

async function finish(
  db: DbExecutor,
  job: JobRow,
  now: Date,
  outcome: { result?: Record<string, number>; error?: unknown },
) {
  // Only the worker that still holds the claim may finish the job (a stale claim may have been requeued).
  const owned = and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedAt, job.lockedAt!));
  if (outcome.error === undefined) {
    const done = await db
      .update(jobs)
      .set({ status: "succeeded", lockedAt: null, result: outcome.result ?? {}, lastError: null, finishedAt: now })
      .where(owned)
      .returning({ id: jobs.id });
    return done.length ? ("succeeded" as const) : ("lost" as const);
  }
  const dead = job.attempts >= job.maxAttempts;
  const failed = await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      lockedAt: null,
      lastError: describeJobError(outcome.error),
      runAfter: dead ? job.runAfter : new Date(now.getTime() + retryDelayMs(job.attempts)),
      finishedAt: dead ? now : null,
    })
    .where(owned)
    .returning({ id: jobs.id });
  if (!failed.length) return "lost" as const;
  return dead ? ("dead" as const) : ("retrying" as const);
}

/** Jobs one tick runs: enough for every schedule plus per-item jobs (document scans, erasures). */
export const DEFAULT_TICK_LIMIT = 25;

export async function runDueJobs(
  deps: { db: Database; now?: () => Date; handlers: JobHandlers },
  opts: { limit?: number; onlyIds?: string[] } = {},
) {
  const clock = deps.now ?? (() => new Date());
  const claimed = await claimDueJobs(deps.db, clock(), opts.limit ?? DEFAULT_TICK_LIMIT, opts.onlyIds);
  const summary = { ran: claimed.length, succeeded: 0, retrying: 0, dead: 0, lost: 0 };
  for (const job of claimed) {
    let outcome: { result?: Record<string, number>; error?: unknown };
    try {
      outcome = { result: await deps.handlers[job.type]({ db: deps.db, now: clock(), payload: job.payload }) };
    } catch (error) {
      outcome = { error };
    }
    summary[await finish(deps.db, job, clock(), outcome)] += 1;
  }
  return summary;
}

/** One cron tick: schedule, recover stuck jobs, run what's due. */
export async function tick(
  deps: { db: Database; now?: () => Date; handlers: JobHandlers },
  opts: { limit?: number } = {},
) {
  const now = (deps.now ?? (() => new Date()))();
  const enqueued = await enqueueDueSchedules(deps.db, now);
  const requeued = await requeueStaleJobs(deps.db, now);
  const ran = await runDueJobs(deps, opts);
  return { enqueued, requeued, ...ran };
}

/** Queues a dead job again with a fresh attempt budget (ops action, audited). */
export async function retryJob(db: DbExecutor, input: { jobId: string; actorId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(jobs)
      .set({ status: "queued", attempts: 0, runAfter: now, finishedAt: null })
      .where(and(eq(jobs.id, input.jobId), eq(jobs.status, "dead")))
      .returning({ id: jobs.id, type: jobs.type });
    if (!row) return false;
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.actorId,
      eventType: "jobs.retried",
      entityType: "job",
      entityId: row.id,
      metadata: { type: row.type },
    });
    return true;
  });
}

/** Runs a schedule now (ops action, audited). */
export async function runScheduleNow(db: DbExecutor, input: { type: JobType; actorId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const id = await enqueueJob(tx, { type: input.type, runAfter: now, requestedBy: input.actorId });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.actorId,
      eventType: "jobs.requested",
      entityType: "job",
      entityId: id,
      metadata: { type: input.type },
    });
    return id;
  });
}

export async function listRecentJobs(db: DbExecutor, limit = 40) {
  return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);
}

export async function lastRunByType(db: DbExecutor) {
  const rows = await db.execute<{ type: JobType; status: string; finished_at: Date | null; created_at: Date }>(sql`
    select distinct on (type) type, status, finished_at, created_at
    from ops.jobs order by type, created_at desc`);
  return new Map(rows.map((r) => [r.type, r]));
}

export async function countJobsByStatus(db: DbExecutor) {
  const rows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<JobRow["status"], number>>;
}
