import { sql, type SQL } from "drizzle-orm";

import type { DbExecutor } from "@/db/types";
import { suppress, type Suppressed } from "@/modules/analytics/suppression";

/**
 * Partner-lender decision analytics (CLAUDE.md §26: "RE accept/modify/reject
 * rate", Stage 15). Aggregates only, split by simulated vs partner lender;
 * small counts suppressed. Reported from the lending module that owns the data.
 */
export interface DecisionRates {
  lender: "simulated" | "partner";
  decisions: Suppressed;
  approvedPct: number | null;
  modifiedPct: number | null;
  declinedPct: number | null;
  /** Share of reviews where staff overrode the simulated decision (simulated only). */
  overriddenPct: number | null;
  offersAnswered: Suppressed;
  acceptedPct: number | null;
}

const pct = (n: number, d: number) => (d >= 5 ? Math.round((n / d) * 1000) / 10 : null);
const asOfFilter = (column: SQL, asOf?: Date) =>
  asOf ? sql`${column} < ${asOf.toISOString()}::timestamptz` : sql`true`;

/** `asOf`: count only what existed before then (the analyst view uses start of today, so figures move once a day). */
export async function decisionAnalytics(db: DbExecutor, input: { asOf?: Date } = {}): Promise<DecisionRates[]> {
  const decisions = [
    ...(await db.execute<{ simulated: boolean; outcome: string; n: number }>(sql`
      select simulated, outcome, count(*)::int as n from (
        -- The latest revision per proposal: a partner's re-decision replaces, not adds to, its earlier one.
        select distinct on (d.proposal_id) (p.policy_version is not null) as simulated, d.outcome
        from fin.lender_decisions d join fin.credit_proposals p on p.id = d.proposal_id
        where ${asOfFilter(sql`d.created_at`, input.asOf)}
        order by d.proposal_id, d.revision desc
      ) latest
      group by 1, 2`)),
  ];
  const reviews = [
    ...(await db.execute<{ simulated: boolean; overridden: number; n: number }>(sql`
      select (p.policy_version is not null) as simulated,
        count(*) filter (where r.action = 'override')::int as overridden, count(*)::int as n
      from fin.decision_reviews r join fin.credit_proposals p on p.id = r.proposal_id
      where ${asOfFilter(sql`r.created_at`, input.asOf)}
      group by 1`)),
  ];
  const answers = [
    ...(await db.execute<{ simulated: boolean; accepted: number; n: number }>(sql`
      select (p.policy_version is not null) as simulated,
        count(*) filter (where o.response = 'accepted')::int as accepted, count(*)::int as n
      from fin.offer_responses o join fin.credit_proposals p on p.id = o.proposal_id
      where ${asOfFilter(sql`o.created_at`, input.asOf)}
      group by 1`)),
  ];
  return ([true, false] as const).map((simulated) => {
    const rows = decisions.filter((d) => d.simulated === simulated);
    const n = rows.reduce((s, r) => s + r.n, 0);
    const of = (o: string) => rows.find((r) => r.outcome === o)?.n ?? 0;
    const review = reviews.find((r) => r.simulated === simulated);
    const answer = answers.find((a) => a.simulated === simulated);
    return {
      lender: simulated ? "simulated" : "partner",
      decisions: suppress(n),
      approvedPct: pct(of("approved"), n),
      modifiedPct: pct(of("modified"), n),
      declinedPct: pct(of("declined"), n),
      overriddenPct: simulated ? pct(review?.overridden ?? 0, review?.n ?? 0) : null,
      offersAnswered: suppress(answer?.n ?? 0),
      acceptedPct: pct(answer?.accepted ?? 0, answer?.n ?? 0),
    };
  });
}
