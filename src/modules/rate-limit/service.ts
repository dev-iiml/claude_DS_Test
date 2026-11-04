import { lt, sql } from "drizzle-orm";

import { rateLimitCounters } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { describeError, logger } from "@/lib/logger";

import { RATE_LIMITS, RATE_LIMIT_RETENTION_HOURS, effectiveLimit, windowFor, type RateLimitBucket } from "./rules";
import { rateLimitMultiplier, rateLimitSubjectKey } from "./subject-key";

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface ConsumeInput {
  bucket: RateLimitBucket;
  /** Raw subject (IP, user id, partner id). Hashed here; never stored as-is. */
  subject: string;
  now?: Date;
}

/**
 * Counts one request against a bucket and says whether it is within the limit.
 * Call it with the plain `db` (not inside the action's transaction), so the
 * count stands even when the action fails.
 *
 * Fails open: if counting itself fails, the request is allowed and the error
 * name is logged — a rate limiter must not take the service down. The
 * business limits behind it (account lockout, OTP and bureau limits) still apply.
 */
export async function consumeRateLimit(db: DbExecutor, input: ConsumeInput): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[input.bucket];
  const now = input.now ?? new Date();
  const { windowStart, retryAfterSeconds } = windowFor(rule, now);
  try {
    const [row] = await db
      .insert(rateLimitCounters)
      .values({
        bucket: input.bucket,
        subjectKey: rateLimitSubjectKey(rule.subject, input.subject),
        windowStart,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [rateLimitCounters.bucket, rateLimitCounters.subjectKey, rateLimitCounters.windowStart],
        set: { count: sql`${rateLimitCounters.count} + 1` },
      })
      .returning({ count: rateLimitCounters.count });
    const limit = effectiveLimit(rule, rateLimitMultiplier());
    if ((row?.count ?? 0) > limit) {
      logger.warn("rate_limit.exceeded", { bucket: input.bucket });
      return { ok: false, retryAfterSeconds };
    }
    return { ok: true };
  } catch (error) {
    logger.error("rate_limit.failed", { bucket: input.bucket, error: describeError(error).name });
    return { ok: true };
  }
}

/** Deletes counters older than the retention window (job `rate_limit_purge`). */
export async function purgeRateLimitCounters(db: DbExecutor, now = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - RATE_LIMIT_RETENTION_HOURS * 3_600_000);
  const [row] = await db.execute<{ n: number }>(sql`
    with gone as (
      delete from ${rateLimitCounters} where ${lt(rateLimitCounters.windowStart, cutoff)} returning 1
    ) select count(*)::int as n from gone`);
  return { deleted: row?.n ?? 0 };
}
