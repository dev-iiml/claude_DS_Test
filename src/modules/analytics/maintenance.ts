import { and, gte, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import type { DbExecutor } from "@/db/types";
import { analyticsDailyCounts } from "@/db/schema";

import { analyticsDay } from "./recorder";

/**
 * Analytics rollups and retention (job `analytics_maintenance`, Stage 15).
 *
 * One transaction under an advisory lock (two runs never interleave):
 * 1. upserts daily counts (events and distinct subjects, no identifiers) for
 *    the last RECENT_DAYS days — the job runs hourly, so older days were rolled
 *    up while recent, and a short outage is caught up;
 * 2. rolls up, then deletes, raw events older than the retention period
 *    (24 months, user decision). Only the days crossing the cutoff are read, so
 *    no run scans the whole table.
 */
export const RAW_EVENT_RETENTION_MONTHS = 24;
const RECENT_DAYS = 7;

export function retentionCutoffDay(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - RAW_EVENT_RETENTION_MONTHS);
  return analyticsDay(d);
}

async function rollUp(tx: DbExecutor, where: ReturnType<typeof sql>, now: Date) {
  const rows = await tx.execute<{ day: string }>(sql`
    insert into analytics.daily_counts (day, event, internal, events, subjects, rolled_up_at)
    select day, event, internal, count(*)::int, count(distinct subject)::int, ${now.toISOString()}::timestamptz
    from analytics.events
    where ${where}
    group by day, event, internal
    on conflict (day, event, internal) do update
      set events = excluded.events, subjects = excluded.subjects, rolled_up_at = excluded.rolled_up_at
    returning day::text as day`);
  return new Set([...rows].map((r) => r.day)).size;
}

export async function maintainAnalytics(deps: { db: Database; now?: Date }) {
  const now = deps.now ?? new Date();
  const recentFrom = analyticsDay(new Date(now.getTime() - RECENT_DAYS * 86_400_000));
  const cutoff = retentionCutoffDay(now);

  return deps.db.transaction(async (tx) => {
    // A second concurrent run waits here, then finds nothing left to do.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('creatorco.analytics_maintenance'))`);
    // Recent days are recomputed from scratch, so erased events drop out of their counts too.
    await tx.execute(sql`delete from analytics.daily_counts where day >= ${recentFrom}::date`);
    const recent = await rollUp(tx, sql`day >= ${recentFrom}::date`, now);
    // Days about to be purged get a final rollup first (covers any day a long outage skipped).
    const expiring = await rollUp(tx, sql`day < ${cutoff}::date`, now);
    await tx.execute(sql`set local creatorco.erasure = 'on'`);
    const purged = await tx.execute<{ n: number }>(sql`
      with gone as (delete from analytics.events where day < ${cutoff}::date returning 1)
      select count(*)::int as n from gone`);
    await tx.execute(sql`set local creatorco.erasure = 'off'`);
    return { days_rolled_up: recent + expiring, raw_events_purged: [...purged][0]?.n ?? 0 };
  });
}

/** Daily totals per event over a window (from rollups, so they outlive the raw events). */
export async function dailyTotals(db: DbExecutor, input: { fromDay: string; includeInternal: boolean }) {
  return db
    .select({
      day: analyticsDailyCounts.day,
      event: analyticsDailyCounts.event,
      events: sql<number>`sum(${analyticsDailyCounts.events})::int`,
    })
    .from(analyticsDailyCounts)
    .where(
      and(
        gte(analyticsDailyCounts.day, input.fromDay),
        input.includeInternal ? undefined : sql`${analyticsDailyCounts.internal} = false`,
      ),
    )
    .groupBy(analyticsDailyCounts.day, analyticsDailyCounts.event);
}
