import { sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/types";

import { FUNNEL_STEPS, type AnalyticsEvent } from "./events";
import { MIN_CELL, suppress, type Suppressed } from "./suppression";

/**
 * Funnel and cohort queries over raw events (Stage 15). Aggregates only —
 * subjects are counted, never listed — and every count below the small-cell
 * threshold is suppressed, so no individual creator can be singled out.
 */
export interface FunnelStepView {
  event: AnalyticsEvent;
  label: string;
  creators: Suppressed;
  /** Share of the cohort (first step) that reached this step, when both counts are shown. */
  ofCohortPct: number | null;
  /** Share of the previous step, when both counts are shown. */
  fromPreviousPct: number | null;
}

export interface FunnelView {
  fromDay: string;
  toDay: string;
  /** Signed-out page views in the window (anonymous; no identifiers). */
  landingViews: Suppressed;
  applicationStarts: Suppressed;
  steps: FunnelStepView[];
}

const pct = (a: Suppressed, b: Suppressed) =>
  a.value !== null && b.value !== null && b.value > 0 ? Math.round((a.value / b.value) * 1000) / 10 : null;

/**
 * Of creators whose account was created in [fromDay, toDay] (India days), how
 * many reached each step (at any time since).
 */
export async function getFunnel(
  db: DbExecutor,
  input: { fromDay: string; toDay: string; includeInternal: boolean },
): Promise<FunnelView> {
  const internal = input.includeInternal ? sql`true` : sql`internal = false`;
  const steps = FUNNEL_STEPS.map((s) => s.event);
  const rows = await db.execute<{ event: string; n: number }>(sql`
    with cohort as (
      select distinct subject from analytics.events
      where event = 'account_created' and day between ${input.fromDay}::date and ${input.toDay}::date and ${internal}
    )
    select e.event, count(distinct e.subject)::int as n
    from analytics.events e join cohort c on c.subject = e.subject
    where e.event in (${sql.join(
      steps.map((s) => sql`${s}`),
      sql`, `,
    )})
    group by e.event`);
  const anon = await db.execute<{ event: string; n: number }>(sql`
    select event, count(*)::int as n from analytics.events
    where event in ('landing_viewed', 'application_started')
      and day between ${input.fromDay}::date and ${input.toDay}::date
    group by event`);
  const count = (list: Iterable<{ event: string; n: number }>, e: string) =>
    [...list].find((r) => r.event === e)?.n ?? 0;

  const views: FunnelStepView[] = [];
  for (const [i, s] of FUNNEL_STEPS.entries()) {
    const creators = suppress(count(rows, s.event));
    views.push({
      event: s.event,
      label: s.label,
      creators,
      ofCohortPct: i === 0 ? null : pct(creators, views[0]!.creators),
      fromPreviousPct: i === 0 ? null : pct(creators, views[i - 1]!.creators),
    });
  }
  return {
    fromDay: input.fromDay,
    toDay: input.toDay,
    landingViews: suppress(count(anon, "landing_viewed")),
    applicationStarts: suppress(count(anon, "application_started")),
    steps: views,
  };
}

export const COHORT_MILESTONES: readonly { event: AnalyticsEvent; label: string }[] = [
  { event: "creator_profile_completed", label: "Profile" },
  { event: "social_connection_completed", label: "Connected" },
  { event: "financial_eligibility_started", label: "Eligibility" },
  { event: "offer_generated", label: "Offer" },
  { event: "access_requested", label: "Access" },
];

export interface CohortRow {
  /** Monday of the India-time week the accounts were created. */
  week: string;
  size: Suppressed;
  /** Share of the cohort reaching each milestone (null when suppressed). */
  reached: Record<string, number | null>;
}

/** Weekly sign-up cohorts and the share reaching each milestone since. */
export async function getWeeklyCohorts(
  db: DbExecutor,
  input: { weeks: number; today: string; includeInternal: boolean },
): Promise<CohortRow[]> {
  const internal = input.includeInternal ? sql`true` : sql`internal = false`;
  const rows = await db.execute<{ week: string; event: string; n: number }>(sql`
    with cohort as (
      select subject, min(date_trunc('week', day))::date as week from analytics.events
      where event = 'account_created' and ${internal}
        and day >= date_trunc('week', ${input.today}::date - ${input.weeks * 7 - 7}::int)::date
      group by subject
    )
    select c.week::text as week, 'account_created' as event, count(*)::int as n from cohort c group by c.week
    union all
    select c.week::text, e.event, count(distinct e.subject)::int
    from cohort c join analytics.events e on e.subject = c.subject
    where e.event in (${sql.join(
      COHORT_MILESTONES.map((m) => sql`${m.event}`),
      sql`, `,
    )})
    group by c.week, e.event
    order by 1 desc`);
  const list = [...rows];
  const weeks = [...new Set(list.map((r) => r.week))].sort().reverse();
  return weeks.map((week) => {
    const size = suppress(list.find((r) => r.week === week && r.event === "account_created")?.n ?? 0);
    const reached: Record<string, number | null> = {};
    for (const m of COHORT_MILESTONES) {
      const n = suppress(list.find((r) => r.week === week && r.event === m.event)?.n ?? 0);
      reached[m.event] = pct(n, size);
    }
    return { week, size, reached };
  });
}

export interface AcquisitionRow {
  /** The slug or referrer kind; "(none)" when untagged, "other (each under 5)" for folded small values. */
  value: string;
  creators: Suppressed;
}

export interface AcquisitionView {
  source: AcquisitionRow[];
  medium: AcquisitionRow[];
  campaign: AcquisitionRow[];
  referrer: AcquisitionRow[];
}

const ACQUISITION_DIMENSIONS = ["utm_source", "utm_medium", "utm_campaign", "referrer"] as const;
export const FOLDED_LABEL = "other (each under 5)";

/**
 * Where the cohort's sign-ups came from (Stage 16): campaign tags and referrer
 * kind on `account_created`. Values with fewer than MIN_CELL creators are
 * folded together, so a small campaign can't point at an individual.
 */
export async function getAcquisition(
  db: DbExecutor,
  input: { fromDay: string; toDay: string; includeInternal: boolean },
): Promise<AcquisitionView> {
  const internal = input.includeInternal ? sql`true` : sql`internal = false`;
  const view = {} as Record<(typeof ACQUISITION_DIMENSIONS)[number], AcquisitionRow[]>;
  for (const dim of ACQUISITION_DIMENSIONS) {
    const rows = await db.execute<{ value: string; n: number }>(sql`
      select coalesce(props ->> ${dim}, '(none)') as value, count(distinct subject)::int as n
      from analytics.events
      where event = 'account_created' and day between ${input.fromDay}::date and ${input.toDay}::date and ${internal}
      group by 1 order by 2 desc, 1`);
    const shown = [...rows].filter((r) => r.n >= MIN_CELL);
    const folded = [...rows].filter((r) => r.n < MIN_CELL).reduce((s, r) => s + r.n, 0);
    view[dim] = [
      ...shown.map((r) => ({ value: r.value, creators: suppress(r.n) })),
      ...(folded ? [{ value: FOLDED_LABEL, creators: suppress(folded) }] : []),
    ];
  }
  return { source: view.utm_source, medium: view.utm_medium, campaign: view.utm_campaign, referrer: view.referrer };
}
