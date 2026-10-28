import { tierAtLeast, type CreatorStatusTier } from "@/modules/creator-status/status";

/**
 * Access preview — pure vocabulary and rules (Stage 14). Opportunities are
 * seeded samples from fictional brands, editable by the partnerships desk;
 * there is no real fulfilment and nothing leaves CreatorCo.
 *
 * Access depends on Creator Status and Creator Points. Neither has, or may
 * have, anything to do with credit.
 */
export const OPPORTUNITY_KINDS = ["pr_drop", "programme", "experience", "event"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export const OPPORTUNITY_KIND_LABELS: Record<OpportunityKind, string> = {
  pr_drop: "PR drop",
  programme: "Programme",
  experience: "Experience",
  event: "Event",
};

export const OPPORTUNITY_STATUSES = ["open", "closed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/**
 * A request moves out of `requested` exactly once (the database enforces it):
 * approved → points spent; declined / cancelled / expired → points returned.
 */
export const ACCESS_REQUEST_STATUSES = ["requested", "approved", "declined", "cancelled", "expired"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const ACCESS_REQUEST_STATUS_LABELS: Record<AccessRequestStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  declined: "Not this time",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Why a request was declined (codes only, never free text). */
export const DECLINE_REASONS = ["places_filled", "not_a_fit", "profile_incomplete", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  places_filled: "All places have been filled",
  not_a_fit: "Not the right fit for this opportunity",
  profile_incomplete: "Your Creator Professional Profile needs more detail",
  other: "Another reason",
};

/** Why a request ended other than a staff decision. */
export const CANCEL_REASONS = ["creator", "membership_paused", "consent_withdrawn"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** An undecided request expires after this long, or when the opportunity closes — whichever is first. */
export const REQUEST_TTL_DAYS = 14;
export const NOTE_MAX_LENGTH = 280;

export function requestExpiresAt(requestedAt: Date, closesAt: Date): Date {
  const ttl = new Date(requestedAt.getTime() + REQUEST_TTL_DAYS * 86_400_000);
  return ttl < closesAt ? ttl : closesAt;
}

export interface OpportunityWindow {
  status: OpportunityStatus;
  opensAt: Date;
  closesAt: Date;
}

export function isOpportunityOpen(o: OpportunityWindow, now: Date): boolean {
  return o.status === "open" && o.opensAt <= now && now < o.closesAt;
}

export type RequestRefusal = "not_open" | "tier_required" | "insufficient_points" | "full" | "already_requested";

export interface RequestEligibilityInput {
  opportunity: OpportunityWindow & { minTier: CreatorStatusTier; pointsCost: number; places: number };
  tier: CreatorStatusTier;
  balance: number;
  approvedCount: number;
  hasActiveRequest: boolean;
  now: Date;
}

/** Whether a creator may request an opportunity right now, and if not, the first reason why. */
export function requestEligibility(
  input: RequestEligibilityInput,
): { ok: true } | { ok: false; reason: RequestRefusal } {
  const o = input.opportunity;
  if (!isOpportunityOpen(o, input.now)) return { ok: false, reason: "not_open" };
  if (input.hasActiveRequest) return { ok: false, reason: "already_requested" };
  if (!tierAtLeast(input.tier, o.minTier)) return { ok: false, reason: "tier_required" };
  if (input.approvedCount >= o.places) return { ok: false, reason: "full" };
  if (input.balance < o.pointsCost) return { ok: false, reason: "insufficient_points" };
  return { ok: true };
}

export const REQUEST_REFUSAL_MESSAGES: Record<RequestRefusal, string> = {
  not_open: "This opportunity isn't taking requests right now.",
  tier_required: "This opportunity is for a higher Creator Status.",
  insufficient_points: "You don't have enough Creator Points for this yet.",
  full: "All places have been filled.",
  already_requested: "You've already requested this opportunity.",
};
