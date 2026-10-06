/**
 * Fraud / authenticity rules (CLAUDE.md §12B, §13 "separate fraud layer").
 * Pure and deterministic: explicit flags with a severity, never a weighted
 * score. Thresholds are product hypotheses to tune with real cases.
 * Inputs are numbers and booleans only — no names, PANs or handles.
 */

export const FRAUD_RULES_VERSION = "fraud-0.1.0";

export const FRAUD_SEVERITIES = ["low", "medium", "high"] as const;
export type FraudSeverity = (typeof FRAUD_SEVERITIES)[number];

export const FRAUD_CATEGORIES = ["identity", "duplicate", "income", "account", "audience", "velocity"] as const;
export type FraudCategory = (typeof FRAUD_CATEGORIES)[number];

export const FRAUD_OUTCOMES = ["clear", "watch", "review"] as const;
/** clear: no flags · watch: only low/medium flags (shown to staff) · review: a high flag → recommendation becomes `refer`. */
export type FraudOutcome = (typeof FRAUD_OUTCOMES)[number];

export const FRAUD_CHECK_CODES = [
  "IDENTITY_NAME_MISMATCH",
  "DUPLICATE_PAN_ACCOUNTS",
  "PAN_CHANGED_ACROSS_CHECKS",
  "DECLARED_INCOME_INCONSISTENT",
  "CONNECTED_HANDLE_MISMATCH",
  "DECLARED_TENURE_UNSUPPORTED",
  "SUSPICIOUS_FOLLOWER_SPIKE",
  "ANOMALOUS_ENGAGEMENT",
  "APPLICATION_VELOCITY",
] as const;
export type FraudCheckCode = (typeof FRAUD_CHECK_CODES)[number];

/** Frozen inputs to a fraud check. `null` = not available (the check doesn't run). */
export interface FraudInputs {
  /** Token match between the declared legal name and the identity-lookup name, 0–1. */
  identity_name_match: number | null;
  /** Other accounts whose open/sent checks carry the same PAN fingerprint. */
  pan_shared_with_other_accounts: number | null;
  /** Distinct PAN fingerprints across this creator's other open/sent checks that differ from this one. */
  pan_changes_across_checks: number | null;
  /** Declared monthly income ÷ creator income observed in bank data. */
  declared_to_observed_income: number | null;
  /** Connected accounts whose handle differs from the handle the creator declared for that platform. */
  connected_handle_mismatches: number | null;
  /** Months by which the declared "creator since" precedes the oldest connected account. */
  declared_tenure_gap_months: number | null;
  /** Professional Graph (professional-analytics consent only). */
  follower_spike_detected: boolean | null;
  engagement_rate_3m: number | null;
  total_audience: number | null;
  /** This creator's eligibility checks started in the last 90 days (including this one). */
  applications_90d: number | null;
}

export const FRAUD_INPUT_KEYS = [
  "identity_name_match",
  "pan_shared_with_other_accounts",
  "pan_changes_across_checks",
  "declared_to_observed_income",
  "connected_handle_mismatches",
  "declared_tenure_gap_months",
  "follower_spike_detected",
  "engagement_rate_3m",
  "total_audience",
  "applications_90d",
] as const satisfies readonly (keyof FraudInputs)[];
// Compile-time guard: every FraudInputs field is listed above.
type MissingFraudKeys = Exclude<keyof FraudInputs, (typeof FRAUD_INPUT_KEYS)[number]>;
const _allFraudKeysListed: MissingFraudKeys extends never ? true : never = true;
void _allFraudKeysListed;

export const FRAUD_THRESHOLDS = {
  nameMatchHigh: 0.5, // below → high
  nameMatchMedium: 0.8, // below → medium
  incomeRatioHigh: 2.5,
  incomeRatioMedium: 1.5,
  tenureGapMonths: 24,
  engagementHigh: 0.2,
  engagementHighMinAudience: 10_000,
  engagementLow: 0.002,
  engagementLowMinAudience: 50_000,
  applications90d: 3,
} as const;

export type FraudEvidence = Record<string, number | boolean | null>;

export interface FraudFlag {
  code: FraudCheckCode;
  category: FraudCategory;
  severity: FraudSeverity;
  evidence: FraudEvidence;
}

export interface FraudCheckStatus {
  code: FraudCheckCode;
  status: "passed" | "flagged" | "not_run";
}

export interface FraudResult {
  rulesVersion: string;
  outcome: FraudOutcome;
  highestSeverity: FraudSeverity | null;
  flags: FraudFlag[];
  checks: FraudCheckStatus[];
}

type Rule = {
  code: FraudCheckCode;
  category: FraudCategory;
  /** null = can't run (missing input); otherwise the severity, or false when passed. */
  evaluate: (i: FraudInputs) => { severity: FraudSeverity | false; evidence: FraudEvidence } | null;
};

const T = FRAUD_THRESHOLDS;

const RULES: Rule[] = [
  {
    code: "IDENTITY_NAME_MISMATCH",
    category: "identity",
    evaluate: ({ identity_name_match: m }) =>
      m === null
        ? null
        : {
            severity: m < T.nameMatchHigh ? "high" : m < T.nameMatchMedium ? "medium" : false,
            evidence: { name_match: m },
          },
  },
  {
    code: "DUPLICATE_PAN_ACCOUNTS",
    category: "duplicate",
    evaluate: ({ pan_shared_with_other_accounts: n }) =>
      n === null ? null : { severity: n > 0 ? "high" : false, evidence: { other_accounts: n } },
  },
  {
    code: "PAN_CHANGED_ACROSS_CHECKS",
    category: "identity",
    evaluate: ({ pan_changes_across_checks: n }) =>
      n === null ? null : { severity: n > 0 ? "medium" : false, evidence: { other_pans: n } },
  },
  {
    code: "DECLARED_INCOME_INCONSISTENT",
    category: "income",
    evaluate: ({ declared_to_observed_income: r }) =>
      r === null
        ? null
        : {
            severity: r > T.incomeRatioHigh ? "high" : r > T.incomeRatioMedium ? "medium" : false,
            evidence: { declared_to_observed: r },
          },
  },
  {
    code: "CONNECTED_HANDLE_MISMATCH",
    category: "account",
    evaluate: ({ connected_handle_mismatches: n }) =>
      n === null ? null : { severity: n > 0 ? "medium" : false, evidence: { mismatched_accounts: n } },
  },
  {
    code: "DECLARED_TENURE_UNSUPPORTED",
    category: "account",
    evaluate: ({ declared_tenure_gap_months: g }) =>
      g === null ? null : { severity: g > T.tenureGapMonths ? "low" : false, evidence: { gap_months: g } },
  },
  {
    code: "SUSPICIOUS_FOLLOWER_SPIKE",
    category: "audience",
    evaluate: ({ follower_spike_detected: s }) =>
      s === null ? null : { severity: s ? "medium" : false, evidence: { spike: s } },
  },
  {
    code: "ANOMALOUS_ENGAGEMENT",
    category: "audience",
    evaluate: ({ engagement_rate_3m: e, total_audience: a }) => {
      if (e === null || a === null) return null;
      const high = e > T.engagementHigh && a >= T.engagementHighMinAudience;
      const low = e < T.engagementLow && a >= T.engagementLowMinAudience;
      return { severity: high || low ? "medium" : false, evidence: { engagement_rate: e, audience: a } };
    },
  },
  {
    code: "APPLICATION_VELOCITY",
    category: "velocity",
    evaluate: ({ applications_90d: n }) =>
      n === null ? null : { severity: n >= T.applications90d ? "low" : false, evidence: { checks_90d: n } },
  },
];

const RANK: Record<FraudSeverity, number> = { low: 1, medium: 2, high: 3 };

export function evaluateFraud(inputs: FraudInputs): FraudResult {
  const flags: FraudFlag[] = [];
  const checks: FraudCheckStatus[] = [];
  for (const rule of RULES) {
    const r = rule.evaluate(inputs);
    if (r === null) {
      checks.push({ code: rule.code, status: "not_run" });
    } else if (r.severity === false) {
      checks.push({ code: rule.code, status: "passed" });
    } else {
      checks.push({ code: rule.code, status: "flagged" });
      flags.push({ code: rule.code, category: rule.category, severity: r.severity, evidence: r.evidence });
    }
  }
  const highest = flags.reduce<FraudSeverity | null>(
    (h, f) => (h === null || RANK[f.severity] > RANK[h] ? f.severity : h),
    null,
  );
  return {
    rulesVersion: FRAUD_RULES_VERSION,
    outcome: highest === "high" ? "review" : highest ? "watch" : "clear",
    highestSeverity: highest,
    flags,
    checks,
  };
}

/** Normalises a person's name into comparable tokens (case, punctuation and honorifics ignored). */
function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !["mr", "mrs", "ms", "dr", "shri", "smt", "kumari"].includes(t));
}

/**
 * How well two names agree, 0–1: the share of the shorter name's tokens found
 * in the longer one. Exact tokens are matched first across the whole name;
 * remaining initials then match a token starting with them (half credit).
 * Order-insensitive ("Sharma Sunil" = "Sunil Sharma"). Returns null when a
 * name has no comparable Latin tokens (e.g. Devanagari, honorifics only), so
 * the check is reported as not run rather than as a mismatch.
 */
export function nameMatchScore(a: string, b: string): number | null {
  const [x, y] = [nameTokens(a), nameTokens(b)];
  if (!x.length || !y.length) return null;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const pool = [...long];
  const unmatched: string[] = [];
  let score = 0;
  for (const t of short) {
    const exact = pool.indexOf(t);
    if (exact >= 0) {
      score += 1;
      pool.splice(exact, 1);
    } else {
      unmatched.push(t);
    }
  }
  for (const t of unmatched) {
    const initial = pool.findIndex((p) => (t.length === 1 && p.startsWith(t)) || (p.length === 1 && t.startsWith(p)));
    if (initial >= 0) {
      score += 0.5;
      pool.splice(initial, 1);
    }
  }
  return Math.round((score / short.length) * 1000) / 1000;
}
