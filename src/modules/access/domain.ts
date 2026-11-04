/**
 * Access (Stage 14) vocabulary — brand opportunities a creator can request
 * with simulated Creator Points. Pure; shared by web, API and native apps.
 *
 * Phase 1 preview: opportunities are seeded or staff-created samples from
 * fictional brands. Nothing is sent to a brand and nothing is fulfilled.
 */
export const OPPORTUNITY_KINDS = ["pr_drop", "programme", "experience", "event"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

/** draft: staff only · live: open to requests between opensAt and closesAt · closed: no new requests. */
export const OPPORTUNITY_STATUSES = ["draft", "live", "closed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/**
 * requested (points held) → approved (points spent) | declined | cancelled | expired (points returned).
 */
export const ACCESS_REQUEST_STATUSES = ["requested", "approved", "declined", "cancelled", "expired"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];
export const ACTIVE_REQUEST_STATUSES = ["requested", "approved"] as const satisfies readonly AccessRequestStatus[];

export const ACCESS_DECLINE_REASONS = ["no_seats", "not_a_fit", "profile_incomplete", "other"] as const;
export type AccessDeclineReason = (typeof ACCESS_DECLINE_REASONS)[number];

export const MAX_POINTS_COST = 1_00_000;
export const MAX_SEATS = 1_000;
export const MAX_REQUEST_NOTE = 280;
