import type { FeatureConfidence, FeatureSource } from "./domain";

/**
 * Professional Graph feature engine — pure and deterministic (no Node/DOM APIs,
 * so it can run unchanged in a native app or a lender-hosted validation job).
 *
 * Same inputs + same ENGINE_VERSION ⇒ byte-identical outputs. Features
 * describe the creator *business* (longevity, consistency, platform mix,
 * authenticity signals). None of them is a credit score. Creator Status (a
 * membership tier) reads some of them; no limit is ever raised automatically.
 *
 * Bump ENGINE_VERSION (and the affected FEATURE_VERSIONS) whenever a formula
 * changes; old runs stay reproducible under their recorded version.
 */
/**
 * 0.2.0 (Stage 11b): several accounts per platform — platforms counted once, concentration by platform.
 * 0.3.0 (Stage 18): brand portfolio features from VERIFIED brand-work records only (drafts, rejected and reversed
 * records never count). Document-verified amounts are not bank-verified income and are never used for affordability.
 */
export const ENGINE_VERSION = "pg-0.3.0";

export const FEATURE_VERSIONS = {
  professional_longevity_months: "1",
  connected_platforms: "2",
  total_audience: "1",
  platform_concentration: "2",
  audience_growth_6m: "1",
  growth_stability: "1",
  engagement_rate_3m: "1",
  engagement_stability: "1",
  posting_consistency_12m: "1",
  declared_not_connected: "1",
  handle_mismatches: "1",
  follower_spike_detected: "1",
  verified_brand_count: "1",
  verified_collaborations_12m: "1",
  repeat_brand_count: "1",
  brand_recurrence_rate: "1",
  brand_tenure_months: "1",
  brand_industry_count: "1",
  brand_industry_concentration: "1",
  top_brand_revenue_share_12m: "1",
  highest_verified_deal: "1",
  median_verified_deal_12m: "1",
  verified_brand_billings_12m: "1",
  deal_value_growth_12m: "1",
  agency_mediated_share: "1",
  payment_confirmation_rate: "1",
} as const;

/** Brand portfolio features (Stage 18). Never read by underwriting, eligibility, lending or Creator Status. */
export const BRAND_FEATURE_KEYS = [
  "verified_brand_count",
  "verified_collaborations_12m",
  "repeat_brand_count",
  "brand_recurrence_rate",
  "brand_tenure_months",
  "brand_industry_count",
  "brand_industry_concentration",
  "top_brand_revenue_share_12m",
  "highest_verified_deal",
  "median_verified_deal_12m",
  "verified_brand_billings_12m",
  "deal_value_growth_12m",
  "agency_mediated_share",
  "payment_confirmation_rate",
] as const;
export type FeatureKey = keyof typeof FEATURE_VERSIONS;

export interface SnapshotInput {
  capturedAt: string; // ISO
  audience: number | null; // followers or subscribers
  engagementRate: number | null;
  postsCount: number | null;
}

export interface AccountInput {
  platform: string;
  handle: string;
  declaredHandle: string | null;
  accountCreatedAt: string | null; // ISO
  snapshots: SnapshotInput[];
}

/** One VERIFIED brand-work record (ids, codes, months and the amount — never names). */
export interface BrandWorkInput {
  id: string;
  brandId: string;
  industry: string;
  billedPartyType: "brand" | "agency" | "platform";
  deliverables: string[];
  workMonth: string; // YYYY-MM
  amountPaise: number | null;
  paymentConfirmed: boolean;
  confirmationMonth: string | null; // YYYY-MM
}

export interface EngineInput {
  asOf: string; // ISO — part of the inputs, so runs are reproducible
  creatorSince: string | null; // YYYY-MM-DD, self-declared
  declaredPlatforms: string[];
  accounts: AccountInput[]; // connected accounts only
  /** Verified brand work as of `asOf` (Stage 18). Optional so older stored inputs still reproduce. */
  brandWork?: BrandWorkInput[];
}

export interface FeatureResult {
  key: FeatureKey;
  version: string;
  value: number | boolean | null;
  unit: "months" | "count" | "people" | "ratio" | "percent" | "flag" | "inr";
  source: FeatureSource;
  completeness: number;
  confidence: FeatureConfidence;
  provenance: Record<string, string | number | boolean | string[]>;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()));
}

const monthKey = (iso: string) => iso.slice(0, 7);

function mean(xs: number[]) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Coefficient of variation (population). */
function cv(xs: number[]) {
  const m = mean(xs);
  if (m === 0) return xs.every((x) => x === 0) ? 0 : 1;
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  return Math.abs(sd / m);
}

function confidenceFor(months: number, verified: boolean): FeatureConfidence {
  if (!verified) return "low";
  if (months >= 12) return "high";
  if (months >= 6) return "medium";
  return "low";
}

/** Sorted, de-duplicated monthly snapshots (last per month). */
function monthly(snaps: SnapshotInput[]) {
  const byMonth = new Map<string, SnapshotInput>();
  for (const s of [...snaps].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)))
    byMonth.set(monthKey(s.capturedAt), s);
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => s);
}

/** Combined audience per month across accounts (only months where every included account has data). */
function combinedAudienceSeries(accounts: AccountInput[]) {
  const series = accounts.map(
    (a) =>
      new Map(
        monthly(a.snapshots)
          .filter((s) => s.audience !== null)
          .map((s) => [monthKey(s.capturedAt), s.audience!]),
      ),
  );
  if (series.length === 0) return [];
  const months = [...new Set(series.flatMap((m) => [...m.keys()]))].sort();
  return months
    .filter((m) => series.every((s) => s.has(m)))
    .map((m) => ({ month: m, audience: series.reduce((t, s) => t + (s.get(m) ?? 0), 0) }));
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

export function computeFeatures(input: EngineInput): FeatureResult[] {
  const out: FeatureResult[] = [];
  const platforms = input.accounts.map((a) => a.platform).sort();
  const verified = input.accounts.length > 0;
  const f = (r: Omit<FeatureResult, "version">) => out.push({ ...r, version: FEATURE_VERSIONS[r.key] });

  // 1. Professional longevity — verified from the oldest connected account, else self-declared.
  const created = input.accounts
    .map((a) => a.accountCreatedAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  const earliestSnapshot = input.accounts.flatMap((a) => a.snapshots.map((s) => s.capturedAt)).sort()[0];
  const verifiedStart = created[0] ?? earliestSnapshot ?? null;
  if (verifiedStart) {
    f({
      key: "professional_longevity_months",
      value: monthsBetween(verifiedStart, input.asOf),
      unit: "months",
      source: "verified",
      completeness: 1,
      confidence: created.length ? "high" : "medium",
      provenance: { basis: created.length ? "account_created_at" : "earliest_snapshot", platforms },
    });
  } else {
    f({
      key: "professional_longevity_months",
      value: input.creatorSince ? monthsBetween(input.creatorSince, input.asOf) : null,
      unit: "months",
      source: "declared",
      completeness: input.creatorSince ? 1 : 0,
      confidence: "low",
      provenance: { basis: "creator_since_declared" },
    });
  }

  // 2. Connected platforms.
  const distinctPlatforms = [...new Set(platforms)];
  f({
    key: "connected_platforms",
    value: distinctPlatforms.length,
    unit: "count",
    source: "verified",
    completeness: 1,
    confidence: "high",
    provenance: { platforms: distinctPlatforms, accounts: input.accounts.length },
  });

  // 3 & 4. Audience and platform concentration (Herfindahl–Hirschman index, 0–1; lower = more diversified).
  const latest = input.accounts
    .map((a) => ({ platform: a.platform, audience: monthly(a.snapshots).at(-1)?.audience ?? null }))
    .filter((x): x is { platform: string; audience: number } => x.audience !== null);
  const total = latest.reduce((t, x) => t + x.audience, 0);
  f({
    key: "total_audience",
    value: latest.length ? total : null,
    unit: "people",
    source: "verified",
    completeness: input.accounts.length ? latest.length / input.accounts.length : 0,
    confidence: latest.length ? "medium" : "low",
    provenance: { platforms: latest.map((x) => x.platform).sort(), note: "sum across platforms; may double-count" },
  });
  // Several accounts on one platform are still one platform: shares are summed per platform first.
  const byPlatform = new Map<string, number>();
  for (const x of latest) byPlatform.set(x.platform, (byPlatform.get(x.platform) ?? 0) + x.audience);
  f({
    key: "platform_concentration",
    value: total > 0 ? round([...byPlatform.values()].reduce((s, a) => s + (a / total) ** 2, 0)) : null,
    unit: "ratio",
    source: "derived",
    completeness: latest.length ? 1 : 0,
    confidence: byPlatform.size >= 2 ? "high" : byPlatform.size === 1 ? "medium" : "low",
    provenance: { platforms: [...byPlatform.keys()].sort() },
  });

  // 5 & 6. Growth over 6 months and stability of monthly net adds.
  const series = combinedAudienceSeries(input.accounts);
  const months = series.length;
  if (months >= 7) {
    const now = series[months - 1]!.audience;
    const then = series[months - 7]!.audience;
    f({
      key: "audience_growth_6m",
      value: then > 0 ? round(((now - then) / then) * 100, 2) : null,
      unit: "percent",
      source: "derived",
      completeness: 1,
      confidence: confidenceFor(months, verified),
      provenance: { months_used: 7, platforms },
    });
  } else {
    f({
      key: "audience_growth_6m",
      value: null,
      unit: "percent",
      source: "derived",
      completeness: round(months / 7, 3),
      confidence: "low",
      provenance: { months_available: months },
    });
  }
  const adds = series.slice(1).map((p, i) => p.audience - series[i]!.audience);
  f({
    key: "growth_stability",
    value: adds.length >= 5 ? round(clamp01(1 - cv(adds))) : null,
    unit: "ratio",
    source: "derived",
    completeness: round(Math.min(1, adds.length / 11), 3),
    confidence: adds.length >= 5 ? confidenceFor(months, verified) : "low",
    provenance: { monthly_changes_used: adds.length },
  });

  // 7 & 8. Engagement level (audience-weighted, last 3 months) and stability.
  const engagementByMonth = new Map<string, { w: number; e: number }>();
  for (const a of input.accounts) {
    for (const s of monthly(a.snapshots)) {
      if (s.engagementRate === null || s.audience === null) continue;
      const k = monthKey(s.capturedAt);
      const cur = engagementByMonth.get(k) ?? { w: 0, e: 0 };
      engagementByMonth.set(k, { w: cur.w + s.audience, e: cur.e + s.engagementRate * s.audience });
    }
  }
  const engagement = [...engagementByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => (v.w ? v.e / v.w : 0));
  const last3 = engagement.slice(-3);
  f({
    key: "engagement_rate_3m",
    value: last3.length ? round(mean(last3), 6) : null,
    unit: "ratio",
    source: "verified",
    completeness: round(last3.length / 3, 3),
    confidence: last3.length === 3 ? "medium" : "low",
    provenance: { months_used: last3.length },
  });
  f({
    key: "engagement_stability",
    value: engagement.length >= 6 ? round(clamp01(1 - cv(engagement))) : null,
    unit: "ratio",
    source: "derived",
    completeness: round(Math.min(1, engagement.length / 12), 3),
    confidence: engagement.length >= 6 ? confidenceFor(engagement.length, verified) : "low",
    provenance: { months_used: engagement.length },
  });

  // 9. Posting consistency: share of the last 12 months with at least one new post (any platform).
  const activeMonths = new Set<string>();
  const observedMonths = new Set<string>();
  for (const a of input.accounts) {
    const m = monthly(a.snapshots);
    m.forEach((s, i) => {
      if (i === 0) return;
      const prev = m[i - 1]!;
      const k = monthKey(s.capturedAt);
      observedMonths.add(k);
      if (s.postsCount !== null && prev.postsCount !== null && s.postsCount > prev.postsCount) activeMonths.add(k);
    });
  }
  const window = [...observedMonths].sort().slice(-12);
  f({
    key: "posting_consistency_12m",
    value: window.length ? round(window.filter((k) => activeMonths.has(k)).length / window.length) : null,
    unit: "ratio",
    source: "derived",
    completeness: round(Math.min(1, window.length / 12), 3),
    confidence: confidenceFor(window.length, verified),
    provenance: { months_observed: window.length },
  });

  // 10 & 11. Authenticity signals (inputs to the Stage 11 fraud layer, not scores).
  const connectedSet = new Set(input.accounts.map((a) => a.platform));
  const notConnected = input.declaredPlatforms.filter((p) => !connectedSet.has(p)).sort();
  f({
    key: "declared_not_connected",
    value: notConnected.length,
    unit: "count",
    source: "derived",
    completeness: 1,
    confidence: "high",
    provenance: { platforms: notConnected },
  });
  const mismatched = input.accounts
    .filter((a) => a.declaredHandle && a.declaredHandle.toLowerCase() !== a.handle.toLowerCase())
    .map((a) => a.platform)
    .sort();
  f({
    key: "handle_mismatches",
    value: mismatched.length,
    unit: "count",
    source: "derived",
    completeness: 1,
    confidence: "high",
    provenance: { platforms: mismatched },
  });

  // 12. Follower spike: any month-over-month jump above 50% on a base of ≥ 1,000.
  const spikes: string[] = [];
  for (const a of input.accounts) {
    const m = monthly(a.snapshots).filter((s) => s.audience !== null);
    for (let i = 1; i < m.length; i++) {
      const prev = m[i - 1]!.audience!;
      if (prev >= 1000 && m[i]!.audience! / prev > 1.5) {
        spikes.push(a.platform);
        break;
      }
    }
  }
  f({
    key: "follower_spike_detected",
    value: input.accounts.length ? spikes.length > 0 : null,
    unit: "flag",
    source: "derived",
    completeness: input.accounts.length ? 1 : 0,
    confidence: input.accounts.length ? "medium" : "low",
    provenance: { platforms: spikes.sort() },
  });

  out.push(...brandFeatures(input));
  return out;
}

// ---------------------------------------------------------------------------
// brand portfolio (Stage 18)
// ---------------------------------------------------------------------------

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** Confidence from how many verified records there are and how long they span. */
function brandConfidence(n: number, spanMonths: number): FeatureConfidence {
  if (n >= 5 && spanMonths >= 12) return "high";
  if (n >= 2) return "medium";
  return "low";
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export function brandFeatures(input: EngineInput): FeatureResult[] {
  const out: FeatureResult[] = [];
  const records = [...(input.brandWork ?? [])].sort(
    (a, b) => a.workMonth.localeCompare(b.workMonth) || a.id.localeCompare(b.id),
  );
  const asOfMonth = monthIndex(input.asOf.slice(0, 7));
  const in12 = (r: BrandWorkInput) => asOfMonth - monthIndex(r.workMonth) < 12 && asOfMonth >= monthIndex(r.workMonth);
  const prior12 = (r: BrandWorkInput) => {
    const d = asOfMonth - monthIndex(r.workMonth);
    return d >= 12 && d < 24;
  };
  const n = records.length;
  const span = n ? monthIndex(records[n - 1]!.workMonth) - monthIndex(records[0]!.workMonth) : 0;
  const confidence = brandConfidence(n, span);
  const ids = (rs: BrandWorkInput[]) => rs.map((r) => r.id);
  const f = (r: Omit<FeatureResult, "version">) => out.push({ ...r, version: FEATURE_VERSIONS[r.key] });
  const base = { source: "verified" as const, confidence };

  const perBrand = new Map<string, number>();
  for (const r of records) perBrand.set(r.brandId, (perBrand.get(r.brandId) ?? 0) + 1);
  const brands = perBrand.size;
  const repeat = [...perBrand.values()].filter((c) => c >= 2).length;
  const last12 = records.filter(in12);
  const prev12 = records.filter(prior12);
  const amounts12 = last12.map((r) => r.amountPaise).filter((a): a is number => a !== null);
  const amountsPrev = prev12.map((r) => r.amountPaise).filter((a): a is number => a !== null);
  const allAmounts = records.map((r) => r.amountPaise).filter((a): a is number => a !== null);

  f({
    key: "verified_brand_count",
    value: brands,
    unit: "count",
    ...base,
    completeness: 1,
    provenance: { records: n, brands },
  });
  f({
    key: "verified_collaborations_12m",
    value: last12.length,
    unit: "count",
    ...base,
    completeness: 1,
    provenance: { record_ids: ids(last12) },
  });
  f({
    key: "repeat_brand_count",
    value: repeat,
    unit: "count",
    ...base,
    completeness: 1,
    provenance: { brands, repeat },
  });
  f({
    key: "brand_recurrence_rate",
    value: brands >= 2 ? round(repeat / brands) : null,
    unit: "ratio",
    ...base,
    completeness: brands >= 2 ? 1 : 0,
    provenance: { brands, repeat },
  });
  f({
    key: "brand_tenure_months",
    value: n ? span : null,
    unit: "months",
    ...base,
    completeness: n ? 1 : 0,
    provenance: { records: n, first: records[0]?.workMonth ?? "", last: records[n - 1]?.workMonth ?? "" },
  });
  const perIndustry = new Map<string, number>();
  for (const r of records) perIndustry.set(r.industry, (perIndustry.get(r.industry) ?? 0) + 1);
  f({
    key: "brand_industry_count",
    value: perIndustry.size,
    unit: "count",
    ...base,
    completeness: 1,
    provenance: { industries: [...perIndustry.keys()].sort() },
  });
  f({
    key: "brand_industry_concentration",
    value: n ? round([...perIndustry.values()].reduce((s, c) => s + (c / n) ** 2, 0)) : null,
    unit: "ratio",
    ...base,
    completeness: n ? 1 : 0,
    provenance: { records: n, industries: perIndustry.size },
  });
  // Client concentration: the largest single brand's share of verified invoice value in 12 months.
  const valueByBrand12 = new Map<string, number>();
  for (const r of last12)
    if (r.amountPaise !== null) valueByBrand12.set(r.brandId, (valueByBrand12.get(r.brandId) ?? 0) + r.amountPaise);
  const total12 = amounts12.reduce((s, a) => s + a, 0);
  f({
    key: "top_brand_revenue_share_12m",
    value: total12 > 0 ? round(Math.max(...valueByBrand12.values()) / total12) : null,
    unit: "ratio",
    ...base,
    completeness: last12.length ? amounts12.length / last12.length : 0,
    provenance: { records_with_amount: amounts12.length, brands: valueByBrand12.size },
  });
  f({
    key: "highest_verified_deal",
    value: allAmounts.length ? Math.max(...allAmounts) / 100 : null,
    unit: "inr",
    ...base,
    completeness: n ? allAmounts.length / n : 0,
    provenance: { records_with_amount: allAmounts.length },
  });
  f({
    key: "median_verified_deal_12m",
    value: amounts12.length >= 3 ? medianOf(amounts12) / 100 : null,
    unit: "inr",
    ...base,
    completeness: amounts12.length >= 3 ? amounts12.length / last12.length : 0,
    provenance: { records_with_amount: amounts12.length },
  });
  f({
    key: "verified_brand_billings_12m",
    value: last12.length ? total12 / 100 : null,
    unit: "inr",
    ...base,
    completeness: last12.length ? amounts12.length / last12.length : 0,
    provenance: { record_ids: ids(last12.filter((r) => r.amountPaise !== null)) },
  });
  const totalPrev = amountsPrev.reduce((s, a) => s + a, 0);
  const growthOk = amounts12.length >= 2 && amountsPrev.length >= 2 && totalPrev > 0;
  f({
    key: "deal_value_growth_12m",
    value: growthOk ? round(((total12 - totalPrev) / totalPrev) * 100, 2) : null,
    unit: "percent",
    ...base,
    completeness: growthOk ? 1 : 0,
    provenance: { last_12m_records: amounts12.length, prior_12m_records: amountsPrev.length },
  });
  f({
    key: "agency_mediated_share",
    value: n ? round(records.filter((r) => r.billedPartyType !== "brand").length / n) : null,
    unit: "ratio",
    ...base,
    completeness: n ? 1 : 0,
    provenance: { records: n },
  });
  f({
    key: "payment_confirmation_rate",
    value: n ? round(records.filter((r) => r.paymentConfirmed).length / n) : null,
    unit: "ratio",
    ...base,
    completeness: n ? 1 : 0,
    provenance: { records: n, confirmed: records.filter((r) => r.paymentConfirmed).length },
  });
  return out;
}

/** Read model for "Brands you've worked with" (no amounts). Sorted by latest month, then collaborations. */
export interface PortfolioBrand {
  brandDirectoryId: string;
  displayName: string;
  industry: string;
  collaborations: number;
  firstMonth: string;
  lastMonth: string;
  paymentConfirmed: boolean;
}

export function brandPortfolio(
  records: readonly (BrandWorkInput & { brandName: string; visibility?: "show_on_passport" | "private" })[],
  opts: { includePrivate: boolean } = { includePrivate: false },
): PortfolioBrand[] {
  const by = new Map<string, PortfolioBrand>();
  for (const r of records) {
    if (!opts.includePrivate && r.visibility === "private") continue;
    const cur = by.get(r.brandId);
    if (!cur) {
      by.set(r.brandId, {
        brandDirectoryId: r.brandId,
        displayName: r.brandName,
        industry: r.industry,
        collaborations: 1,
        firstMonth: r.workMonth,
        lastMonth: r.workMonth,
        paymentConfirmed: r.paymentConfirmed,
      });
    } else {
      cur.collaborations += 1;
      if (r.workMonth < cur.firstMonth) cur.firstMonth = r.workMonth;
      if (r.workMonth > cur.lastMonth) cur.lastMonth = r.workMonth;
      cur.paymentConfirmed ||= r.paymentConfirmed;
    }
  }
  return [...by.values()].sort(
    (a, b) =>
      b.lastMonth.localeCompare(a.lastMonth) ||
      b.collaborations - a.collaborations ||
      a.displayName.localeCompare(b.displayName),
  );
}
