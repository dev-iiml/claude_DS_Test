import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditEvents, jobs, users } from "@/db/schema";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { enqueueJob, retryJob, runDueJobs, tick, type JobHandlers } from "@/modules/jobs";
import { JOB_HANDLERS } from "@/modules/jobs/handlers";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const T0 = new Date("2030-01-01T00:02:00Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);

const ok: JobHandlers["provider_health_check"] = async () => ({ done: 1 });
const handlers = (override: Partial<JobHandlers> = {}): JobHandlers => ({
  expire_stale_applications: ok,
  process_deferred_erasures: ok,
  provider_health_check: ok,
  purge_expired_fi_data: ok,
  process_lender_proposals: ok,
  deliver_partner_webhooks: ok,
  expire_access_requests: ok,
  analytics_maintenance: ok,
  ...override,
});

describe("Job runner", () => {
  it("enqueues each schedule once per window and runs them", async () => {
    const first = await tick({ db, now: at(0), handlers: handlers() });
    expect(first).toMatchObject({ enqueued: 8, succeeded: 8, dead: 0 });
    const again = await tick({ db, now: at(30_000), handlers: handlers() });
    expect(again.enqueued).toBe(0);
    // The 1-minute webhook window rolls over first…
    const nextMinute = await tick({ db, now: at(60_000), handlers: handlers() });
    expect(nextMinute.enqueued).toBe(1);
    // …then the 5-minute health check and proposal sweep, before the hourly ones.
    const later = await tick({ db, now: at(5 * 60_000), handlers: handlers() });
    expect(later.enqueued).toBe(3);
  });

  it("retries failures with backoff, then marks the job dead; ops can retry it", async () => {
    const id = (await enqueueJob(db, { type: "expire_stale_applications", maxAttempts: 2, runAfter: T0 }))!;
    const failing = handlers({
      expire_stale_applications: async () => {
        throw new Error("Failed query: select 1 params: secret-value");
      },
    });
    expect(await runDueJobs({ db, now: at(0), handlers: failing })).toMatchObject({ retrying: 1 });
    let [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(job!.runAfter.getTime()).toBe(T0.getTime() + 30_000);
    expect(job!.lastError).not.toContain("secret-value");

    // Not due yet.
    expect((await runDueJobs({ db, now: at(10_000), handlers: failing })).ran).toBe(0);
    expect(await runDueJobs({ db, now: at(30_000), handlers: failing })).toMatchObject({ dead: 1 });
    [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe("dead");

    const r = await signUpCreator(authDepsFor(db), { email: testEmail("ops"), password: "a long enough passphrase" });
    if (!r.ok) throw new Error();
    await db.update(users).set({ role: "ops_admin" }).where(eq(users.id, r.user.userId));
    expect(await retryJob(db, { jobId: id, actorId: r.user.userId, now: T0 })).toBe(true);
    expect(await runDueJobs({ db, now: at(40_000), handlers: handlers() })).toMatchObject({ succeeded: 1 });
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(audit!.eventType).toBe("jobs.retried");
  });

  it("recovers jobs stuck in running after a worker died", async () => {
    const id = (await enqueueJob(db, { type: "process_deferred_erasures", runAfter: T0 }))!;
    await db.update(jobs).set({ status: "running", lockedAt: T0, attempts: 1 }).where(eq(jobs.id, id));
    const result = await tick({ db, now: at(16 * 60_000), handlers: handlers() });
    expect(result.requeued).toBeGreaterThanOrEqual(1);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe("succeeded");
  });

  it("a job whose worker keeps dying ends up dead, and a worker that lost its claim can't overwrite it", async () => {
    const id = (await enqueueJob(db, { type: "process_deferred_erasures", maxAttempts: 1, runAfter: T0 }))!;
    await db.update(jobs).set({ status: "running", lockedAt: T0, attempts: 1 }).where(eq(jobs.id, id));
    await tick({ db, now: at(20 * 60_000), handlers: handlers() });
    let [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(job).toMatchObject({ status: "dead", lastError: "Worker stopped before finishing" });

    const other = (await enqueueJob(db, { type: "provider_health_check", runAfter: T0 }))!;
    const slow = handlers({
      provider_health_check: async () => {
        // Meanwhile the claim went stale and another worker re-claimed the job.
        await db
          .update(jobs)
          .set({ lockedAt: at(99_000)() })
          .where(eq(jobs.id, other));
        return { done: 1 };
      },
    });
    const summary = await runDueJobs({ db, now: at(30 * 60_000), handlers: slow }, { onlyIds: [other] });
    expect(summary).toMatchObject({ ran: 1, lost: 1, succeeded: 0 });
    [job] = await db.select().from(jobs).where(eq(jobs.id, other));
    expect(job!.status).toBe("running");
  });

  it("real handlers run against the domain sweeps", async () => {
    const result = await JOB_HANDLERS.provider_health_check({ db, now: new Date(), payload: {} });
    expect(result.checked).toBeGreaterThan(0);
    expect(await JOB_HANDLERS.expire_stale_applications({ db, now: new Date(), payload: {} })).toHaveProperty(
      "expired",
    );
  });
});
