/**
 * Creator Status — a membership tier reflecting professional standing
 * (verified activity, longevity, reach quality, consistency, authenticity).
 *
 * Creator Status is NOT creditworthiness. It must never be an input that
 * automatically raises a credit recommendation or limit (CLAUDE.md §15); a
 * unit test fails if any credit module imports it. The tier is calculated by
 * `rules.ts` from Professional Graph signals (Stage 14).
 */
export const CREATOR_STATUS_TIERS = ["member", "onyx", "icon"] as const;
export type CreatorStatusTier = (typeof CREATOR_STATUS_TIERS)[number];

export const CREATOR_STATUS_LABELS: Record<CreatorStatusTier, string> = {
  member: "Member",
  onyx: "Onyx",
  icon: "Icon",
};

/** Ordering used to compare tiers (e.g. an opportunity's minimum tier). */
export const CREATOR_STATUS_RANK: Record<CreatorStatusTier, number> = { member: 0, onyx: 1, icon: 2 };

export function tierAtLeast(tier: CreatorStatusTier, minimum: CreatorStatusTier): boolean {
  return CREATOR_STATUS_RANK[tier] >= CREATOR_STATUS_RANK[minimum];
}

/** Every member starts here; also the tier when no status has been calculated (or it was erased). */
export const DEFAULT_CREATOR_STATUS: CreatorStatusTier = "member";

/** @deprecated Stage 05 placeholder — use `getCurrentCreatorStatus` from the status service. */
export function currentCreatorStatus(): CreatorStatusTier {
  return DEFAULT_CREATOR_STATUS;
}
