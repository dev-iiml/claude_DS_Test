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
/** 0.2.0 (Stage 11b): several accounts per platform — platforms counted once, concentration by platform. */
export const ENGINE_VERSION = "pg-0.2.0";

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
} as const;
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

export interface EngineInput {
  asOf: string; // ISO — part of the inputs, so runs are reproducible
  creatorSince: string | null; // YYYY-MM-DD, self-declared
  declaredPlatforms: string[];
  accounts: AccountInput[]; // connected accounts only
}

export interface FeatureResult {
  key: FeatureKey;
  version: string;
  value: number | boolean | null;
  unit: "months" | "count" | "people" | "ratio" | "percent" | "flag";
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

  return out;
}
