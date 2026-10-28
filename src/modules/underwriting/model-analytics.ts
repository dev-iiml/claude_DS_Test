import { sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/types";
import { suppress, type Suppressed } from "@/modules/analytics/suppression";

/**
 * Risk / model analytics (CLAUDE.md §26, Stage 15) — aggregates over the
 * regulated domain's own tables, computed here (the module that owns them),
 * never copied into product analytics. No applicant identities, no individual
 * runs; counts of checks below the small-cell threshold are suppressed, and so
 * are averages over them. Every comparison is a hypothesis until lender outcome
 * data validates it.
 */
export interface ModelOutcomeRates {
  model: string;
  runs: Suppressed;
  recommendPct: number | null;
  referPct: number | null;
  notRecommendedPct: number | null;
}

export interface ModelAnalytics {
  runs: Suppressed;
  versions: { version: string; runs: Suppressed }[];
  byModel: ModelOutcomeRates[];
  paired: {
    runs: Suppressed;
    /** Average Creator-Enhanced minus Traditional recommended amount (₹), over runs where both recommend an amount. */
    avgLimitDelta: number | null;
    higher: Suppressed;
    same: Suppressed;
    lower: Suppressed;
    /** Traditional didn't recommend, Creator-Enhanced did — and the reverse. */
    enhancedOnly: Suppressed;
    traditionalOnly: Suppressed;
  };
  missingness: { model: string; component: string; missingPct: number | null }[];
  fraud: { checked: Suppressed; flaggedPct: number | null; reviewPct: number | null };
}

const pct = (n: number, d: number) => (d >= 5 ? Math.round((n / d) * 1000) / 10 : null);

export interface ModelAnalyticsOptions {
  /** Count only runs before this instant (the analyst view uses start of today, so figures move once a day). */
  asOf?: Date;
  /** Round the average amount difference to this many rupees (e.g. 1,000 for the analyst view). */
  roundDeltaTo?: number;
}

export async function modelAnalytics(db: DbExecutor, opts: ModelAnalyticsOptions = {}): Promise<ModelAnalytics> {
  const before = opts.asOf ? sql`${opts.asOf.toISOString()}::timestamptz` : sql`'infinity'::timestamptz`;
  const [total] = [
    ...(await db.execute<{ n: number }>(
      sql`select count(*)::int as n from fin.underwriting_runs where computed_at < ${before}`,
    )),
  ];
  const versions = [
    ...(await db.execute<{ version: string; n: number }>(sql`
      select model_version as version, count(*)::int as n from fin.underwriting_runs
      where computed_at < ${before} group by 1 order by 1 desc`)),
  ];
  const outcomes = [
    ...(await db.execute<{ model: string; outcome: string; n: number }>(sql`
      select model, outcome, count(*)::int as n from fin.underwriting_results
      where created_at < ${before} group by 1, 2`)),
  ];
  const models = [...new Set(outcomes.map((o) => o.model))].sort().reverse();
  const byModel = models.map((model) => {
    const of = (o: string) => outcomes.find((x) => x.model === model && x.outcome === o)?.n ?? 0;
    const n = outcomes.filter((x) => x.model === model).reduce((s, x) => s + x.n, 0);
    return {
      model,
      runs: suppress(n),
      recommendPct: pct(of("recommend"), n),
      referPct: pct(of("refer"), n),
      notRecommendedPct: pct(of("not_recommended"), n),
    };
  });

  const [p] = [
    ...(await db.execute<{
      runs: number;
      both: number;
      avg_delta: string | null;
      higher: number;
      same: number;
      lower: number;
      enhanced_only: number;
      traditional_only: number;
    }>(sql`
      select count(*)::int as runs,
        count(*) filter (where t.recommended_exposure is not null and e.recommended_exposure is not null)::int as both,
        avg(e.recommended_exposure - t.recommended_exposure)
          filter (where t.recommended_exposure is not null and e.recommended_exposure is not null) as avg_delta,
        count(*) filter (where coalesce(e.recommended_exposure, 0) > coalesce(t.recommended_exposure, 0))::int as higher,
        count(*) filter (where coalesce(e.recommended_exposure, 0) = coalesce(t.recommended_exposure, 0))::int as same,
        count(*) filter (where coalesce(e.recommended_exposure, 0) < coalesce(t.recommended_exposure, 0))::int as lower,
        count(*) filter (where t.outcome <> 'recommend' and e.outcome = 'recommend')::int as enhanced_only,
        count(*) filter (where t.outcome = 'recommend' and e.outcome <> 'recommend')::int as traditional_only
      from fin.underwriting_results t
      join fin.underwriting_results e on e.run_id = t.run_id and e.model = 'creator_enhanced'
      where t.model = 'traditional' and t.created_at < ${before}`)),
  ];

  const missing = [
    ...(await db.execute<{ model: string; component: string; missing: number; n: number }>(sql`
      select r.model, c.key as component,
        count(*) filter (where c.value = 'null'::jsonb)::int as missing, count(*)::int as n
      from fin.underwriting_results r, jsonb_each(r.components) c
      where r.created_at < ${before}
      group by 1, 2 order by 1 desc, 2`)),
  ];

  const [f] = [
    ...(await db.execute<{ n: number; flagged: number; review: number }>(sql`
      select count(*)::int as n,
        count(*) filter (where outcome <> 'clear')::int as flagged,
        count(*) filter (where outcome = 'review')::int as review
      from fin.fraud_checks where computed_at < ${before}`)),
  ];

  const both = p?.both ?? 0;
  return {
    runs: suppress(total?.n ?? 0),
    versions: versions.map((v) => ({ version: v.version, runs: suppress(v.n) })),
    byModel,
    paired: {
      runs: suppress(p?.runs ?? 0),
      avgLimitDelta:
        both >= 5 && p?.avg_delta !== null && p?.avg_delta !== undefined
          ? Math.round(Number(p.avg_delta) / (opts.roundDeltaTo ?? 1)) * (opts.roundDeltaTo ?? 1)
          : null,
      higher: suppress(p?.higher ?? 0),
      same: suppress(p?.same ?? 0),
      lower: suppress(p?.lower ?? 0),
      enhancedOnly: suppress(p?.enhanced_only ?? 0),
      traditionalOnly: suppress(p?.traditional_only ?? 0),
    },
    missingness: missing.map((m) => ({ model: m.model, component: m.component, missingPct: pct(m.missing, m.n) })),
    fraud: {
      checked: suppress(f?.n ?? 0),
      flaggedPct: pct(f?.flagged ?? 0, f?.n ?? 0),
      reviewPct: pct(f?.review ?? 0, f?.n ?? 0),
    },
  };
}
