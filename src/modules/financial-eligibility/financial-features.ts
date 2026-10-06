import type { FeatureConfidence, FeatureSource } from "@/modules/professional-graph/domain";

import type { BureauScoreBand, CashflowCoverage } from "./domain";

/**
 * Financial Capacity feature engine — pure and deterministic (no Node/DOM
 * APIs), mirroring the Professional Graph engine. Inputs are the derived
 * summaries CreatorCo is allowed to hold; outputs feed the Traditional and
 * Creator-Enhanced underwriting models (Stage 10).
 *
 * These are inputs, not a decision: no feature here is an eligibility or
 * limit. Bump FIN_ENGINE_VERSION whenever a formula changes.
 *
 * 0.2.0 (Stage 09b, user decision): income is bank-verified creator income
 * only — obligations are never measured against declared income, and the
 * declared-vs-observed comparison runs only when the creator says every
 * income account is shared. Adds bank-coverage features.
 */
export const FIN_ENGINE_VERSION = "fin-0.2.0";

export const FIN_FEATURE_VERSIONS = {
  bureau_score_band: "1",
  active_credit_accounts: "1",
  delinquencies_12m: "1",
  credit_enquiries_6m: "1",
  avg_monthly_inflow_6m: "1",
  inflow_volatility_6m: "1",
  avg_monthly_creator_income_6m: "1",
  creator_income_share_6m: "1",
  creator_income_months_12m: "1",
  avg_monthly_net_cashflow_6m: "1",
  declared_monthly_income: "1",
  declared_to_observed_income: "2",
  declared_monthly_emi: "1",
  emi_to_income: "2",
  income_source_count: "1",
  bank_accounts_shared: "1",
  bank_accounts_not_received: "1",
  bank_coverage: "1",
} as const;
export type FinFeatureKey = keyof typeof FIN_FEATURE_VERSIONS;

export interface FinancialEngineInput {
  asOf: string; // ISO date — part of the inputs, so runs are reproducible
  declared: { monthlyIncome: number; monthlyEmi: number; incomeSources: string[] };
  bureau: {
    scoreBand: BureauScoreBand;
    activeTradelines: number;
    delinquentTradelines12m: number;
    enquiries6m: number;
  } | null;
  /** Monthly totals across shared accounts (own-account transfers excluded), any order; empty without bank data. */
  cashflow: { month: string; inflow: number; outflow: number; creatorIncome: number | null }[];
  /** Which accounts the totals cover. */
  coverage: { status: CashflowCoverage; accountsShared: number; accountsNotReceived: number };
}

export interface FinFeatureResult {
  key: FinFeatureKey;
  version: string;
  value: number | string | null;
  unit: "band" | "count" | "inr" | "ratio" | "level";
  source: FeatureSource;
  completeness: number;
  confidence: FeatureConfidence;
  provenance: Record<string, string | number | boolean | string[]>;
}

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function cv(xs: number[]) {
  const m = mean(xs);
  if (m === 0) return xs.every((x) => x === 0) ? 0 : 1;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / Math.abs(m);
}

export function computeFinancialFeatures(input: FinancialEngineInput): FinFeatureResult[] {
  const out: FinFeatureResult[] = [];
  const f = (r: Omit<FinFeatureResult, "version">) => out.push({ ...r, version: FIN_FEATURE_VERSIONS[r.key] });

  // Bureau (verified via the partner bureau).
  const b = input.bureau;
  const bureauBase = {
    source: "verified" as const,
    completeness: b ? 1 : 0,
    confidence: b ? ("high" as const) : ("low" as const),
  };
  f({
    key: "bureau_score_band",
    value: b?.scoreBand ?? null,
    unit: "band",
    ...bureauBase,
    provenance: { basis: "bureau_summary" },
  });
  f({
    key: "active_credit_accounts",
    value: b?.activeTradelines ?? null,
    unit: "count",
    ...bureauBase,
    provenance: { basis: "bureau_summary" },
  });
  f({
    key: "delinquencies_12m",
    value: b?.delinquentTradelines12m ?? null,
    unit: "count",
    ...bureauBase,
    provenance: { basis: "bureau_summary" },
  });
  f({
    key: "credit_enquiries_6m",
    value: b?.enquiries6m ?? null,
    unit: "count",
    ...bureauBase,
    provenance: { basis: "bureau_summary" },
  });

  // Cashflow (verified via the Account Aggregator), most recent months first.
  const months = [...input.cashflow].sort((a, c) => c.month.localeCompare(a.month));
  const last6 = months.slice(0, 6);
  const last12 = months.slice(0, 12);
  const has6 = last6.length > 0;
  const cfConfidence = (n: number): FeatureConfidence => (n >= 6 ? "high" : n >= 3 ? "medium" : "low");
  const cf = (n: number, target: number) => ({
    completeness: round(Math.min(1, n / target), 3),
    confidence: has6 ? cfConfidence(n) : ("low" as const),
  });

  const inflows = last6.map((m) => m.inflow);
  const avgInflow = has6 ? Math.round(mean(inflows)) : null;
  f({
    key: "avg_monthly_inflow_6m",
    value: avgInflow,
    unit: "inr",
    source: "verified",
    ...cf(last6.length, 6),
    provenance: { months_used: last6.length },
  });
  f({
    key: "inflow_volatility_6m",
    value: last6.length >= 3 ? round(cv(inflows)) : null,
    unit: "ratio",
    source: "derived",
    ...cf(last6.length, 6),
    provenance: { months_used: last6.length },
  });

  const classified = last6.filter((m) => m.creatorIncome !== null);
  const avgCreatorIncome = classified.length ? Math.round(mean(classified.map((m) => m.creatorIncome!))) : null;
  f({
    key: "avg_monthly_creator_income_6m",
    value: avgCreatorIncome,
    unit: "inr",
    source: "verified",
    ...cf(classified.length, 6),
    provenance: { months_used: classified.length },
  });
  const inflowSum = classified.reduce((s, m) => s + m.inflow, 0);
  f({
    key: "creator_income_share_6m",
    value:
      classified.length && inflowSum > 0
        ? round(classified.reduce((s, m) => s + m.creatorIncome!, 0) / inflowSum)
        : null,
    unit: "ratio",
    source: "derived",
    ...cf(classified.length, 6),
    provenance: { months_used: classified.length },
  });
  const classified12 = last12.filter((m) => m.creatorIncome !== null);
  f({
    key: "creator_income_months_12m",
    value: classified12.length
      ? round(classified12.filter((m) => m.creatorIncome! > 0).length / classified12.length)
      : null,
    unit: "ratio",
    source: "derived",
    ...cf(classified12.length, 12),
    provenance: { months_observed: classified12.length },
  });
  f({
    key: "avg_monthly_net_cashflow_6m",
    value: has6 ? Math.round(mean(last6.map((m) => m.inflow - m.outflow))) : null,
    unit: "inr",
    source: "derived",
    ...cf(last6.length, 6),
    provenance: { months_used: last6.length },
  });

  // Declared by the creator.
  const declared = { source: "declared" as const, completeness: 1, confidence: "low" as const };
  f({
    key: "declared_monthly_income",
    value: input.declared.monthlyIncome,
    unit: "inr",
    ...declared,
    provenance: { basis: "application" },
  });
  // Only meaningful when the bank data covers every account income lands in (else unshared income looks "missing").
  const comparable = input.coverage.status === "complete" && avgCreatorIncome !== null && avgCreatorIncome > 0;
  f({
    key: "declared_to_observed_income",
    value: comparable ? round(input.declared.monthlyIncome / avgCreatorIncome!, 3) : null,
    unit: "ratio",
    source: "derived",
    completeness: comparable ? 1 : 0,
    confidence: comparable ? cfConfidence(classified.length) : "low",
    provenance: { observed_months: classified.length, coverage: input.coverage.status },
  });
  f({
    key: "declared_monthly_emi",
    value: input.declared.monthlyEmi,
    unit: "inr",
    ...declared,
    provenance: { basis: "application" },
  });

  // Obligations against bank-verified creator income only (never declared income).
  const verified = avgCreatorIncome !== null && avgCreatorIncome > 0;
  f({
    key: "emi_to_income",
    value: verified ? round(input.declared.monthlyEmi / avgCreatorIncome!) : null,
    unit: "ratio",
    source: "derived",
    completeness: verified ? 1 : 0,
    confidence: verified ? (input.coverage.status === "complete" ? "medium" : "low") : "low",
    provenance: { income_basis: verified ? "verified" : "none" },
  });
  f({
    key: "income_source_count",
    value: new Set(input.declared.incomeSources).size,
    unit: "count",
    ...declared,
    provenance: { sources: [...new Set(input.declared.incomeSources)].sort() },
  });

  // Bank coverage (which accounts the cashflow figures represent).
  const shared = input.coverage.accountsShared > 0;
  f({
    key: "bank_accounts_shared",
    value: input.coverage.accountsShared,
    unit: "count",
    source: "verified",
    completeness: 1,
    confidence: shared ? "high" : "low",
    provenance: { basis: "account_aggregator" },
  });
  f({
    key: "bank_accounts_not_received",
    value: input.coverage.accountsNotReceived,
    unit: "count",
    source: "verified",
    completeness: 1,
    confidence: shared ? "high" : "low",
    provenance: { basis: "account_aggregator" },
  });
  f({
    key: "bank_coverage",
    value: input.coverage.status,
    unit: "level",
    source: "declared",
    completeness: 1,
    confidence: input.coverage.status === "complete" ? "medium" : "low",
    provenance: { basis: "creator_answer_and_account_status" },
  });

  return out;
}
