import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ANALYTICS_EVENT_NAMES, ANALYTICS_TIERS, ONCE_EVENTS } from "@/modules/analytics/events";

import { sqlInList } from "./_shared";

/**
 * Product analytics (Stage 15) — its own schema, first-party only.
 *
 * Pseudonymous: `subject` is a keyed hash of the user id (never the id itself,
 * never contact details), and anonymous events have no subject at all. No
 * foreign keys to any other table, and nothing from the `fin` schema.
 * Raw events are kept 24 months (user decision), then only the daily counts.
 */
export const analytics = pgSchema("analytics");

export const analyticsEvents = analytics.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: text("event", { enum: ANALYTICS_EVENT_NAMES as [string, ...string[]] }).notNull(),
    eventVersion: integer("event_version").notNull(),
    tier: text("tier", { enum: ANALYTICS_TIERS }).notNull(),
    /** `<keyVersion>:<hex>` pseudonym, or null for anonymous events. */
    subject: text("subject"),
    props: jsonb("props").$type<Record<string, string | boolean | null>>().notNull().default({}),
    /** Test / staff-adjacent accounts (excluded from dashboards by default). */
    internal: boolean("internal").notNull().default(false),
    /**
     * Calendar day in India time — the only time recorded. No timestamp is kept, so an event can't be
     * re-linked to an account by matching times (e.g. account_created vs users.created_at).
     */
    day: date("day", { mode: "string" }).notNull(),
  },
  (t) => [
    index("analytics_events_event_day_idx").on(t.event, t.day),
    index("analytics_events_subject_idx").on(t.subject, t.event),
    index("analytics_events_day_idx").on(t.day),
    // "Once" events are unique per subject (first occurrence only), safe under concurrency.
    uniqueIndex("analytics_events_once_key")
      .on(t.subject, t.event)
      .where(sql`${t.event} in (${sqlInList(ONCE_EVENTS)}) and ${t.subject} is not null`),
    check("analytics_events_event_valid", sql`${t.event} in (${sqlInList(ANALYTICS_EVENT_NAMES)})`),
    check("analytics_events_tier_valid", sql`${t.tier} in (${sqlInList(ANALYTICS_TIERS)})`),
    check("analytics_events_subject_format", sql`${t.subject} is null or ${t.subject} ~ '^a[0-9]+:[0-9a-f]{32}$'`),
    check(
      "analytics_events_props_bounded",
      sql`jsonb_typeof(${t.props}) = 'object' and pg_column_size(${t.props}) <= 1024`,
    ),
  ],
);

/** Daily aggregates per event (no identifiers). Kept after raw events are purged. */
export const analyticsDailyCounts = analytics.table(
  "daily_counts",
  {
    day: date("day", { mode: "string" }).notNull(),
    event: text("event").notNull(),
    internal: boolean("internal").notNull(),
    events: integer("events").notNull(),
    subjects: integer("subjects").notNull(),
    rolledUpAt: timestamp("rolled_up_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.event, t.internal] }),
    check("analytics_daily_counts_nonnegative", sql`${t.events} >= 0 and ${t.subjects} >= 0`),
  ],
);
