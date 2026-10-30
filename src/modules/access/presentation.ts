import { CREATOR_STATUS_LABELS, type CreatorStatusTier } from "@/modules/creator-status/status";

import type { AccessDeclineReason, AccessRequestStatus, OpportunityKind, OpportunityStatus } from "./domain";

/** Display copy for Access. Pure. */

export const OPPORTUNITY_KIND_LABELS: Record<OpportunityKind, string> = {
  pr_drop: "PR drop",
  programme: "Programme",
  experience: "Experience",
  event: "Event",
};

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  draft: "Draft",
  live: "Live",
  closed: "Closed",
};

export const ACCESS_REQUEST_STATUS_LABELS: Record<AccessRequestStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  declined: "Not selected",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const ACCESS_DECLINE_REASON_LABELS: Record<AccessDeclineReason, string> = {
  no_seats: "All places were taken",
  not_a_fit: "Not the right fit this time",
  profile_incomplete: "Profile needs more detail",
  other: "Other",
};

/** Short badge for an opportunity above the creator's Status: "Onyx+ only" or "Icon only". */
export function tierLockLabel(tier: CreatorStatusTier): string {
  return tier === "icon" ? "Icon only" : `${CREATOR_STATUS_LABELS[tier]}+ only`;
}

/** Who may request: "All members", "Onyx and above" or "Icon only". */
export function tierRequirementLabel(tier: CreatorStatusTier): string {
  return tier === "member" ? "All members" : tier === "icon" ? "Icon only" : `${CREATOR_STATUS_LABELS[tier]} and above`;
}
