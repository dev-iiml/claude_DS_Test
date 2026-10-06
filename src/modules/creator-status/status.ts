/**
 * Creator Status — a membership tier reflecting professional standing
 * (reach quality, longevity, brand activity, participation).
 *
 * Creator Status is NOT creditworthiness. It must never be an input that
 * automatically raises a credit recommendation or limit (CLAUDE.md §15).
 * Status calculation arrives with the Professional Graph; until then every
 * member is `member`.
 */
export const CREATOR_STATUS_TIERS = ["member", "onyx", "icon"] as const;
export type CreatorStatusTier = (typeof CREATOR_STATUS_TIERS)[number];

export const CREATOR_STATUS_LABELS: Record<CreatorStatusTier, string> = {
  member: "Member",
  onyx: "Onyx",
  icon: "Icon",
};

export function currentCreatorStatus(): CreatorStatusTier {
  return "member";
}
