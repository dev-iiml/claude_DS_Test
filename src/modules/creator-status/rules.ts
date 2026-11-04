import type { CreatorStatusTier } from "./status";

/**
 * Creator Status rules — pure and deterministic (no Node/DOM APIs).
 *
 * Status is a membership tier built from Professional Graph signals about the
 * creator's professional standing. Every tier is an explicit checklist, so a
 * creator can see exactly why they hold a tier and what the next one asks for.
 * Reach is one criterion among several — never the whole picture — and a
 * missing signal is "not met", never guessed.
 *
 * NOT creditworthiness: nothing here is read by underwriting, fraud or lending.
 *
 * Thresholds are product hypotheses (Stage 14) to be tuned with real creators.
 * Any change bumps STATUS_RULES_VERSION; stored runs keep their version.
 * Brand activity is part of Status in CLAUDE.md §15 but has no data source yet,
 * so it is not a criterion until it does.
 */
export const STATUS_RULES_VERSION = "cs-0.1.0";

/** Signals Status reads, all from the creator's latest Professional Graph run. */
export interface StatusInputs {
  /** Professional longevity — only when verified from connected accounts (self-declared doesn't count). */
  verifiedLongevityMonths: number | null;
  connectedPlatforms: number;
  totalAudience: number | null;
  /** Average engagement rate over the last 3 months, as a ratio (0.025 = 2.5%). */
  engagementRate3m: number | null;
  /** 0–1, higher is steadier. */
  engagementStability: number | null;
  /** Share of the last 12 months with posts, 0–1. */
  postingConsistency12m: number | null;
  followerSpikeDetected: boolean | null;
  handleMismatches: number | null;
}

export const EMPTY_STATUS_INPUTS: StatusInputs = {
  verifiedLongevityMonths: null,
  connectedPlatforms: 0,
  totalAudience: null,
  engagementRate3m: null,
  engagementStability: null,
  postingConsistency12m: null,
  followerSpikeDetected: null,
  handleMismatches: null,
};

export const STATUS_CRITERIA = [
  "verified_activity",
  "longevity",
  "reach",
  "engagement_quality",
  "consistency",
  "engagement_stability",
  "authenticity",
] as const;
export type StatusCriterion = (typeof STATUS_CRITERIA)[number];

type Threshold = number;
interface TierRequirements {
  verified_activity: Threshold; // connected platforms
  longevity: Threshold; // verified months
  reach: Threshold; // people
  engagement_quality: Threshold; // ratio
  consistency: Threshold; // ratio of months
  engagement_stability: Threshold | null; // ratio; null = not required
  authenticity: true; // no follower spike, no handle mismatch
}

export const TIER_REQUIREMENTS: Record<Exclude<CreatorStatusTier, "member">, TierRequirements> = {
  onyx: {
    verified_activity: 1,
    longevity: 24,
    reach: 25_000,
    engagement_quality: 0.02,
    consistency: 0.6,
    engagement_stability: null,
    authenticity: true,
  },
  icon: {
    verified_activity: 2,
    longevity: 48,
    reach: 2_50_000,
    engagement_quality: 0.03,
    consistency: 0.75,
    engagement_stability: 0.7,
    authenticity: true,
  },
};

export type CriterionState = "met" | "not_met" | "missing";

export interface CriterionResult {
  tier: Exclude<CreatorStatusTier, "member">;
  key: StatusCriterion;
  state: CriterionState;
  /** The threshold for this tier (number), or null for pass/fail criteria. */
  threshold: number | null;
  /** The creator's value, when there is one. */
  value: number | null;
}

export interface StatusEvaluation {
  version: string;
  tier: CreatorStatusTier;
  criteria: CriterionResult[];
}

function atLeast(value: number | null, threshold: number): CriterionState {
  if (value === null || !Number.isFinite(value)) return "missing";
  return value >= threshold ? "met" : "not_met";
}

function evaluateTier(tier: "onyx" | "icon", s: StatusInputs): CriterionResult[] {
  const r = TIER_REQUIREMENTS[tier];
  const out: CriterionResult[] = [
    {
      tier,
      key: "verified_activity",
      state: s.connectedPlatforms >= r.verified_activity ? "met" : "not_met",
      threshold: r.verified_activity,
      value: s.connectedPlatforms,
    },
    {
      tier,
      key: "longevity",
      state: atLeast(s.verifiedLongevityMonths, r.longevity),
      threshold: r.longevity,
      value: s.verifiedLongevityMonths,
    },
    { tier, key: "reach", state: atLeast(s.totalAudience, r.reach), threshold: r.reach, value: s.totalAudience },
    {
      tier,
      key: "engagement_quality",
      state: atLeast(s.engagementRate3m, r.engagement_quality),
      threshold: r.engagement_quality,
      value: s.engagementRate3m,
    },
    {
      tier,
      key: "consistency",
      state: atLeast(s.postingConsistency12m, r.consistency),
      threshold: r.consistency,
      value: s.postingConsistency12m,
    },
  ];
  if (r.engagement_stability !== null) {
    out.push({
      tier,
      key: "engagement_stability",
      state: atLeast(s.engagementStability, r.engagement_stability),
      threshold: r.engagement_stability,
      value: s.engagementStability,
    });
  }
  const authenticity: CriterionState =
    s.followerSpikeDetected === null || s.handleMismatches === null
      ? "missing"
      : !s.followerSpikeDetected && s.handleMismatches === 0
        ? "met"
        : "not_met";
  out.push({ tier, key: "authenticity", state: authenticity, threshold: null, value: null });
  return out;
}

/** The tier is the highest whose every criterion is met. */
export function evaluateStatus(inputs: StatusInputs): StatusEvaluation {
  const onyx = evaluateTier("onyx", inputs);
  const icon = evaluateTier("icon", inputs);
  const all = (cs: CriterionResult[]) => cs.every((c) => c.state === "met");
  const tier: CreatorStatusTier = all(onyx) && all(icon) ? "icon" : all(onyx) ? "onyx" : "member";
  return { version: STATUS_RULES_VERSION, tier, criteria: [...onyx, ...icon] };
}

/** The feature values Status reads, picked from a graph run's features. */
export function statusInputsFromFeatures(
  features: readonly { key: string; value: number | boolean | null; source: string }[],
): StatusInputs {
  const num = (key: string) => {
    const f = features.find((x) => x.key === key);
    return typeof f?.value === "number" ? f.value : null;
  };
  const longevity = features.find((x) => x.key === "professional_longevity_months");
  const spike = features.find((x) => x.key === "follower_spike_detected");
  return {
    verifiedLongevityMonths:
      longevity?.source === "verified" && typeof longevity.value === "number" ? longevity.value : null,
    connectedPlatforms: num("connected_platforms") ?? 0,
    totalAudience: num("total_audience"),
    engagementRate3m: num("engagement_rate_3m"),
    engagementStability: num("engagement_stability"),
    postingConsistency12m: num("posting_consistency_12m"),
    followerSpikeDetected: typeof spike?.value === "boolean" ? spike.value : null,
    handleMismatches: num("handle_mismatches"),
  };
}
