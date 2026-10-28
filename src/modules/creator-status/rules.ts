import type { CreatorStatusTier } from "./status";

/**
 * Creator Status rules — pure and deterministic (no Node/DOM/Next APIs, so
 * native apps and audits can reuse them).
 *
 * A tier is earned only when EVERY criterion for it is met. Each criterion
 * reads one Professional Graph signal; a missing signal is "not met" — never
 * guessed. Reach is one criterion among several, so reach alone never earns a
 * tier. Nothing here reads, or may ever read, financial data.
 *
 * Thresholds are product hypotheses (Stage 14), not validated measures. Any
 * change bumps CREATOR_STATUS_RULES_VERSION; stored runs keep the version
 * they were calculated under.
 */
export const CREATOR_STATUS_RULES_VERSION = "cs-0.1.0";

export const STATUS_CRITERIA = [
  "verified_activity",
  "verified_longevity",
  "reach",
  "engagement_quality",
  "posting_consistency",
  "steady_engagement",
  "authenticity",
] as const;
export type StatusCriterion = (typeof STATUS_CRITERIA)[number];

export type EarnedTier = Exclude<CreatorStatusTier, "member">;

interface Thresholds {
  platforms: number;
  longevityMonths: number;
  audience: number;
  /** Ratio, e.g. 0.02 = 2%. */
  engagementRate: number;
  /** Share of observed months with a new post. */
  postingConsistency: number;
  /** Engagement stability (0–1); null = not a criterion for this tier. */
  engagementStability: number | null;
}

export const STATUS_THRESHOLDS: Record<EarnedTier, Thresholds> = {
  onyx: {
    platforms: 1,
    longevityMonths: 24,
    audience: 25_000,
    engagementRate: 0.02,
    postingConsistency: 0.6,
    engagementStability: null,
  },
  icon: {
    platforms: 2,
    longevityMonths: 48,
    audience: 250_000,
    engagementRate: 0.03,
    postingConsistency: 0.75,
    engagementStability: 0.7,
  },
};

/** The slice of a Professional Graph signal the rules need. */
export interface StatusSignal {
  value: number | boolean | null;
  source: string;
}
export type StatusSignals = Partial<Record<string, StatusSignal>>;

export interface CriterionResult {
  criterion: StatusCriterion;
  met: boolean;
  /** The signal value used (null when missing). Booleans for authenticity are reported as met/not met only. */
  value: number | null;
  /** The threshold it was compared with (null for authenticity). */
  threshold: number | null;
}

export interface TierChecklist {
  tier: EarnedTier;
  met: boolean;
  criteria: CriterionResult[];
}

export interface StatusEvaluation {
  rulesVersion: typeof CREATOR_STATUS_RULES_VERSION;
  tier: CreatorStatusTier;
  checklists: TierChecklist[];
}

function numeric(signals: StatusSignals, key: string): number | null {
  const v = signals[key]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function atLeast(criterion: StatusCriterion, value: number | null, threshold: number): CriterionResult {
  return { criterion, met: value !== null && value >= threshold, value, threshold };
}

function checklistFor(tier: EarnedTier, signals: StatusSignals): TierChecklist {
  const t = STATUS_THRESHOLDS[tier];
  // Longevity only counts when it is verified from connected accounts, never self-declared.
  const longevity =
    signals.professional_longevity_months?.source === "verified"
      ? numeric(signals, "professional_longevity_months")
      : null;
  const spike = signals.follower_spike_detected?.value;
  const mismatches = numeric(signals, "handle_mismatches");
  const authentic = spike === false && mismatches === 0;

  const criteria: CriterionResult[] = [
    atLeast("verified_activity", numeric(signals, "connected_platforms"), t.platforms),
    atLeast("verified_longevity", longevity, t.longevityMonths),
    atLeast("reach", numeric(signals, "total_audience"), t.audience),
    atLeast("engagement_quality", numeric(signals, "engagement_rate_3m"), t.engagementRate),
    atLeast("posting_consistency", numeric(signals, "posting_consistency_12m"), t.postingConsistency),
  ];
  if (t.engagementStability !== null) {
    criteria.push(atLeast("steady_engagement", numeric(signals, "engagement_stability"), t.engagementStability));
  }
  criteria.push({ criterion: "authenticity", met: authentic, value: null, threshold: null });
  return { tier, met: criteria.every((c) => c.met), criteria };
}

/** Calculates the tier and the full per-tier checklist from Professional Graph signals. */
export function evaluateCreatorStatus(signals: StatusSignals): StatusEvaluation {
  const onyx = checklistFor("onyx", signals);
  const icon = checklistFor("icon", signals);
  const tier: CreatorStatusTier = icon.met ? "icon" : onyx.met ? "onyx" : "member";
  return { rulesVersion: CREATOR_STATUS_RULES_VERSION, tier, checklists: [onyx, icon] };
}
