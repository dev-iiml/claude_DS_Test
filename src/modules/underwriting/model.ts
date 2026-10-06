/**
 * Underwriting Engine v0 — deterministic, explainable, versioned (CLAUDE.md §13).
 *
 * Two models over the same frozen feature snapshot:
 * - **Traditional**: conventional financial components only.
 * - **Creator-Enhanced**: the same plus creator-professional components.
 *
 * The weights and policy constants are a PRODUCT HYPOTHESIS, not a validated
 * credit model. Nothing here claims that creator signals reduce default risk.
 * Output is a CreatorCo recommendation; the partner lender's approved credit
 * policy makes the decision. Pure: no Node/DOM/DB — reproducible anywhere.
 *
 * Bump UNDERWRITING_MODEL_VERSION whenever a weight, band or formula changes.
 */
/**
 * 0.2.0 (Stage 11): the fraud layer can route a recommendation to `refer`.
 * 0.3.0 (Stage 09b, user decision): the income basis is bank-verified creator
 * income only — declared income is never used (it may include cash and gifts
 * partner lenders don't accept). No verified income → `refer` with no amount;
 * partial bank coverage is flagged and caps confidence.
 */
export const UNDERWRITING_MODEL_VERSION = "uw-0.3.0";

export const COMPONENTS = [
  "financial_strength",
  "income_stability",
  "creator_business_stability",
  "revenue_diversification",
  "professional_longevity",
  "audience_authenticity",
  "brand_recurrence",
] as const;
export type Component = (typeof COMPONENTS)[number];

/** Creator Professional Graph features the Creator-Enhanced model may use (with professional-analytics consent). */
export const PROFESSIONAL_INPUTS = [
  "professional_longevity_months",
  "connected_platforms",
  "platform_concentration",
  "growth_stability",
  "engagement_stability",
  "posting_consistency_12m",
  "follower_spike_detected",
  "handle_mismatches",
  "declared_not_connected",
] as const;

/** CLAUDE.md §13 hypothesis weights (user decision: adopt as-is). */
export const ENHANCED_WEIGHTS: Record<Component, number> = {
  financial_strength: 0.35,
  income_stability: 0.2,
  creator_business_stability: 0.15,
  revenue_diversification: 0.1,
  professional_longevity: 0.1,
  audience_authenticity: 0.05,
  brand_recurrence: 0.05,
};
export const TRADITIONAL_COMPONENTS: readonly Component[] = ["financial_strength", "income_stability"];

/**
 * Affordability policy (user decision: affordability-based exposure).
 * The reference rate only converts an affordable EMI into a principal for
 * the recommendation — pricing is the lender's; replace with partner input.
 */
export const POLICY = {
  maxTotalEmiToIncome: 0.4,
  referenceAnnualRate: 0.2,
  tenorMonths: 12,
  /** Grade cap as a multiple of the monthly income basis. */
  gradeIncomeMultiple: { A: 3, B: 2, C: 1.25, D: 0.6, E: 0 },
  roundTo: 5_000,
  minExposure: 10_000,
  /** Below this share of weighted inputs, refer rather than recommend. */
  minCompleteness: 0.5,
} as const;

export const GRADES = ["A", "B", "C", "D", "E"] as const;
export type Grade = (typeof GRADES)[number];

export type ModelName = "traditional" | "creator_enhanced";
export type Outcome = "recommend" | "refer" | "not_recommended";

/** The frozen inputs to a run: numeric or band values, null when unavailable. */
export type FeatureSnapshot = Record<string, number | string | boolean | null>;

export interface ReasonCode {
  code: string;
  effect: "positive" | "negative" | "info";
  component: Component | "exposure" | "data" | "fraud";
}

export interface ModelResult {
  model: ModelName;
  modelVersion: string;
  score: number | null; // 0–100
  grade: Grade | null;
  components: Partial<Record<Component, number | null>>;
  completeness: number; // share of model weight with data
  confidence: "low" | "medium" | "high";
  outcome: Outcome;
  /** Bank-verified creator income only (never declared income). */
  incomeBasis: { monthly: number; source: "verified" } | null;
  recommendedExposure: number | null; // INR
  maxRecommendedExposure: number | null; // INR
  recommendedTenorMonths: number | null;
  reasonCodes: ReasonCode[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (s: FeatureSnapshot, k: string) => (typeof s[k] === "number" ? (s[k] as number) : null);
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const BUREAU_POINTS: Record<string, number> = { no_hit: 50, thin: 45, low: 30, medium: 65, high: 85 };

// ---------------------------------------------------------------------------
// Component scorers (0–100, null when the inputs are missing)
// ---------------------------------------------------------------------------

function financialStrength(s: FeatureSnapshot, rc: ReasonCode[]): number | null {
  const band = typeof s.bureau_score_band === "string" ? s.bureau_score_band : null;
  if (!band) return null;
  const delinquencies = num(s, "delinquencies_12m") ?? 0;
  const enquiries = num(s, "credit_enquiries_6m") ?? 0;
  let bureau = BUREAU_POINTS[band] ?? 40;
  bureau -= 30 * delinquencies + 5 * Math.max(0, enquiries - 2);
  if (band === "high") rc.push({ code: "BUREAU_STRONG", effect: "positive", component: "financial_strength" });
  if (band === "low") rc.push({ code: "BUREAU_WEAK", effect: "negative", component: "financial_strength" });
  if (band === "no_hit" || band === "thin")
    rc.push({ code: "BUREAU_THIN_FILE", effect: "info", component: "financial_strength" });
  if (delinquencies > 0)
    rc.push({ code: "RECENT_MISSED_PAYMENTS", effect: "negative", component: "financial_strength" });
  if (enquiries > 2) rc.push({ code: "HIGH_RECENT_ENQUIRIES", effect: "negative", component: "financial_strength" });

  const emiRatio = num(s, "emi_to_income");
  const affordability =
    emiRatio === null ? null : emiRatio <= 0.1 ? 100 : emiRatio <= 0.3 ? 70 : emiRatio <= 0.5 ? 40 : 10;
  if (emiRatio !== null && emiRatio <= 0.1)
    rc.push({ code: "LOW_EXISTING_OBLIGATIONS", effect: "positive", component: "financial_strength" });
  if (emiRatio !== null && emiRatio > 0.4)
    rc.push({ code: "HIGH_EXISTING_OBLIGATIONS", effect: "negative", component: "financial_strength" });
  return round1(clamp(affordability === null ? bureau : 0.6 * clamp(bureau) + 0.4 * affordability));
}

function incomeStability(s: FeatureSnapshot, rc: ReasonCode[]): number | null {
  const cv = num(s, "inflow_volatility_6m");
  const months = num(s, "creator_income_months_12m");
  if (cv === null && months === null) {
    rc.push({ code: "NO_BANK_DATA", effect: "info", component: "income_stability" });
    return null;
  }
  if (cv !== null && cv < 0.15) rc.push({ code: "STEADY_INFLOWS", effect: "positive", component: "income_stability" });
  if (cv !== null && cv >= 0.35)
    rc.push({ code: "VOLATILE_INFLOWS", effect: "negative", component: "income_stability" });
  if (months !== null && months < 0.75)
    rc.push({ code: "INCOME_GAPS", effect: "negative", component: "income_stability" });
  const ratio = num(s, "declared_to_observed_income");
  if (ratio !== null && ratio > 1.25)
    rc.push({ code: "DECLARED_ABOVE_OBSERVED_INCOME", effect: "negative", component: "income_stability" });
  return round1(clamp(avg([cv === null ? null : 100 - cv * 150, months === null ? null : months * 100])!));
}

function creatorBusinessStability(s: FeatureSnapshot, rc: ReasonCode[]): number | null {
  const parts = [num(s, "posting_consistency_12m"), num(s, "growth_stability"), num(s, "engagement_stability")];
  const v = avg(parts);
  if (v === null) return null;
  const score = round1(clamp(v * 100));
  if (score >= 75)
    rc.push({ code: "CONSISTENT_CREATOR_ACTIVITY", effect: "positive", component: "creator_business_stability" });
  if (score < 40)
    rc.push({ code: "INCONSISTENT_CREATOR_ACTIVITY", effect: "negative", component: "creator_business_stability" });
  return score;
}

function revenueDiversification(s: FeatureSnapshot, rc: ReasonCode[]): number | null {
  const sources = num(s, "income_source_count");
  const hhi = num(s, "platform_concentration");
  const sourceScore = sources === null ? null : sources >= 4 ? 100 : sources === 3 ? 80 : sources === 2 ? 60 : 30;
  const v = avg([sourceScore, hhi === null ? null : (1 - hhi) * 100 + 20]);
  if (v === null) return null;
  const score = round1(clamp(v));
  if (score >= 70) rc.push({ code: "DIVERSIFIED_INCOME", effect: "positive", component: "revenue_diversification" });
  if (score < 40) rc.push({ code: "CONCENTRATED_INCOME", effect: "negative", component: "revenue_diversification" });
  return score;
}

function professionalLongevity(s: FeatureSnapshot, rc: ReasonCode[]): number | null {
  const months = num(s, "professional_longevity_months");
  if (months === null) return null;
  if (months >= 36) rc.push({ code: "ESTABLISHED_CREATOR", effect: "positive", component: "professional_longevity" });
  if (months < 12) rc.push({ code: "EARLY_CAREER_CREATOR", effect: "negative", component: "professional_longevity" });
  return round1(clamp((months / 48) * 100));
}

function audienceAuthenticity(s: FeatureSnapshot, rc: ReasonCode[]): number | null {
  const connected = num(s, "connected_platforms");
  if (!connected) return null; // nothing verified to assess
  let score = 100;
  if (s.follower_spike_detected === true) score -= 50;
  score -= 25 * (num(s, "handle_mismatches") ?? 0);
  score -= 10 * (num(s, "declared_not_connected") ?? 0);
  if (score < 60) rc.push({ code: "AUTHENTICITY_REVIEW", effect: "negative", component: "audience_authenticity" });
  return round1(clamp(score));
}

function brandRecurrence(_s: FeatureSnapshot, rc: ReasonCode[]): number | null {
  // No brand/campaign history is collected yet (Stage 14+). Missing, never guessed.
  rc.push({ code: "BRAND_HISTORY_UNAVAILABLE", effect: "info", component: "brand_recurrence" });
  return null;
}

const SCORERS: Record<Component, (s: FeatureSnapshot, rc: ReasonCode[]) => number | null> = {
  financial_strength: financialStrength,
  income_stability: incomeStability,
  creator_business_stability: creatorBusinessStability,
  revenue_diversification: revenueDiversification,
  professional_longevity: professionalLongevity,
  audience_authenticity: audienceAuthenticity,
  brand_recurrence: brandRecurrence,
};

export function gradeFor(score: number): Grade {
  return score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "E";
}

/** Principal that an EMI supports over `months` at the reference rate (standard annuity). */
export function principalForEmi(emi: number, months: number, annualRate: number): number {
  const r = annualRate / 12;
  return r === 0 ? emi * months : (emi * (1 - (1 + r) ** -months)) / r;
}

/** Bank-verified creator income, or null when none was seen (no data, or none classifiable as creator income). */
function verifiedIncome(s: FeatureSnapshot) {
  const verified = num(s, "avg_monthly_creator_income_6m");
  return verified !== null && verified > 0 ? { monthly: verified, source: "verified" as const } : null;
}

function exposure(s: FeatureSnapshot, grade: Grade, rc: ReasonCode[], incomeBasis: { monthly: number }) {
  const existingEmi = num(s, "declared_monthly_emi") ?? 0;
  const affordableEmi = Math.max(0, POLICY.maxTotalEmiToIncome * incomeBasis.monthly - existingEmi);
  const affordable = principalForEmi(affordableEmi, POLICY.tenorMonths, POLICY.referenceAnnualRate);
  const gradeCap = POLICY.gradeIncomeMultiple[grade] * incomeBasis.monthly;
  const max = Math.floor(Math.min(affordable, gradeCap) / POLICY.roundTo) * POLICY.roundTo;
  if (affordable < gradeCap) rc.push({ code: "LIMITED_BY_AFFORDABILITY", effect: "info", component: "exposure" });
  else rc.push({ code: "LIMITED_BY_RISK_GRADE", effect: "info", component: "exposure" });
  return max;
}

export function runModel(model: ModelName, snapshot: FeatureSnapshot): ModelResult {
  const components = model === "traditional" ? TRADITIONAL_COMPONENTS : COMPONENTS;
  const reasonCodes: ReasonCode[] = [];
  const scores: Partial<Record<Component, number | null>> = {};
  for (const c of components) scores[c] = SCORERS[c](snapshot, reasonCodes);

  const totalWeight = components.reduce((t, c) => t + ENHANCED_WEIGHTS[c], 0);
  const available = components.filter((c) => scores[c] !== null);
  const availableWeight = available.reduce((t, c) => t + ENHANCED_WEIGHTS[c], 0);
  const completeness = Math.round((availableWeight / totalWeight) * 1000) / 1000;
  const partialBank = snapshot.bank_coverage === "partial";
  const byCompleteness = completeness >= 0.8 ? "high" : completeness >= 0.6 ? "medium" : "low";
  // Some income accounts weren't shared: never more than medium confidence.
  const confidence = partialBank && byCompleteness === "high" ? "medium" : byCompleteness;
  if (partialBank) reasonCodes.push({ code: "PARTIAL_BANK_COVERAGE", effect: "info", component: "data" });
  if (
    model === "creator_enhanced" &&
    PROFESSIONAL_INPUTS.every((k) => snapshot[k] === undefined || snapshot[k] === null)
  ) {
    reasonCodes.push({ code: "CREATOR_SIGNALS_UNAVAILABLE", effect: "info", component: "data" });
  }

  const base = {
    model,
    modelVersion: UNDERWRITING_MODEL_VERSION,
    components: scores,
    completeness,
    confidence,
    recommendedTenorMonths: null,
  } as const;

  // Without a bureau summary, or with too little weighted data, refer rather than guess.
  if (scores.financial_strength === null || completeness < POLICY.minCompleteness) {
    reasonCodes.push({ code: "INSUFFICIENT_DATA", effect: "info", component: "data" });
    return {
      ...base,
      score: null,
      grade: null,
      outcome: "refer",
      incomeBasis: null,
      recommendedExposure: null,
      maxRecommendedExposure: null,
      reasonCodes,
    };
  }

  const score = round1(
    available.reduce((t, c) => t + (scores[c] as number) * ENHANCED_WEIGHTS[c], 0) / availableWeight,
  );
  const grade = gradeFor(score);
  const incomeBasis = verifiedIncome(snapshot);
  if (!incomeBasis) {
    // No verified income: a recommendation without an amount, for a partner lender to review.
    reasonCodes.push({ code: "NO_VERIFIED_INCOME", effect: "info", component: "exposure" });
    return {
      ...base,
      score,
      grade,
      outcome: "refer",
      incomeBasis: null,
      recommendedExposure: null,
      maxRecommendedExposure: null,
      reasonCodes,
    };
  }
  const max = exposure(snapshot, grade, reasonCodes, incomeBasis);
  const requested = num(snapshot, "requested_amount");
  const recommended = requested !== null ? Math.min(max, requested) : max;
  if (requested !== null && requested < max)
    reasonCodes.push({ code: "LIMITED_BY_REQUEST", effect: "info", component: "exposure" });

  const viable = grade !== "E" && recommended >= POLICY.minExposure;
  return {
    ...base,
    score,
    grade,
    outcome: viable ? "recommend" : "not_recommended",
    incomeBasis,
    recommendedExposure: viable ? recommended : 0,
    maxRecommendedExposure: viable ? max : 0,
    recommendedTenorMonths: viable ? POLICY.tenorMonths : null,
    reasonCodes,
  };
}

export interface UnderwritingComparison {
  traditional: ModelResult;
  creatorEnhanced: ModelResult;
  /** Creator-Enhanced minus Traditional — a hypothesis to validate with outcome data, not proof. */
  delta: { score: number | null; exposure: number | null; gradeSteps: number | null };
}

export function underwrite(snapshot: FeatureSnapshot): UnderwritingComparison {
  const traditional = runModel("traditional", snapshot);
  const creatorEnhanced = runModel("creator_enhanced", snapshot);
  const gi = (g: Grade | null) => (g ? GRADES.indexOf(g) : null);
  const t = gi(traditional.grade);
  const e = gi(creatorEnhanced.grade);
  return {
    traditional,
    creatorEnhanced,
    delta: {
      score:
        traditional.score !== null && creatorEnhanced.score !== null
          ? round1(creatorEnhanced.score - traditional.score)
          : null,
      exposure:
        traditional.recommendedExposure !== null && creatorEnhanced.recommendedExposure !== null
          ? creatorEnhanced.recommendedExposure - traditional.recommendedExposure
          : null,
      gradeSteps: t !== null && e !== null ? t - e : null, // positive = enhanced grade better
    },
  };
}

/**
 * Applies the separate fraud layer (CLAUDE.md §13). It never changes scores,
 * grades or exposures: a high-severity flag routes a `recommend` to `refer`
 * (user decision — CreatorCo never auto-declines on fraud signals; the lender
 * decides). Lower flags add an informational reason for staff.
 */
export function applyFraudLayer(
  comparison: UnderwritingComparison,
  fraud: { outcome: "clear" | "watch" | "review" },
): UnderwritingComparison {
  if (fraud.outcome === "clear") return comparison;
  const adjust = (r: ModelResult): ModelResult =>
    fraud.outcome === "review"
      ? {
          ...r,
          outcome: r.outcome === "recommend" ? "refer" : r.outcome,
          reasonCodes: [...r.reasonCodes, { code: "FRAUD_REVIEW", effect: "negative", component: "fraud" }],
        }
      : { ...r, reasonCodes: [...r.reasonCodes, { code: "FRAUD_WATCH", effect: "info", component: "fraud" }] };
  return {
    ...comparison,
    traditional: adjust(comparison.traditional),
    creatorEnhanced: adjust(comparison.creatorEnhanced),
  };
}
