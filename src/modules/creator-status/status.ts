/**
 * Creator Status — a membership tier reflecting professional standing
 * (verified activity, longevity, reach, engagement quality, consistency,
 * authenticity). Rules live in `./rules.ts`.
 *
 * Creator Status is NOT creditworthiness. It is never an input to underwriting,
 * fraud, lending or any limit (CLAUDE.md §15) — `tests/unit/status-isolation`
 * enforces that those modules never import it.
 */
export const CREATOR_STATUS_TIERS = ["member", "onyx", "icon"] as const;
export type CreatorStatusTier = (typeof CREATOR_STATUS_TIERS)[number];

export const CREATOR_STATUS_LABELS: Record<CreatorStatusTier, string> = {
  member: "Member",
  onyx: "Onyx",
  icon: "Icon",
};

/** Member < Onyx < Icon. */
export function tierRank(tier: CreatorStatusTier): number {
  return CREATOR_STATUS_TIERS.indexOf(tier);
}

export function meetsTier(current: CreatorStatusTier, required: CreatorStatusTier): boolean {
  return tierRank(current) >= tierRank(required);
}
