import { MINIMUM_PROPOSAL_PROFILE, type ProposalDataGroup } from "@/providers/lender/proposal";

/**
 * Lender orchestration vocabulary (Stage 12). CreatorCo prepares and sends a
 * credit proposal; the partner lender (simulated in the pilot) decides; a
 * CreatorCo risk admin confirms or overrides the decision before the creator
 * sees it (user decision).
 */
export const PROPOSAL_STATUSES = [
  /** Fraud review: waits for a risk admin to release it (user decision). */
  "held",
  /** Ready to send (or retrying after a failure). */
  "queued",
  /**
   * Being sent right now. The check is locked as `submitted` for the duration,
   * so the creator can't change it and withdrawal can't cancel a proposal the
   * lender may already be receiving.
   */
  "sending",
  /** With the lender, no decision yet. */
  "submitted",
  /** The lender decided. */
  "decided",
  /** Sending failed too many times, or the proposal can't be built. Staff can retry. */
  "failed",
  /** Not sent: the creator changed the check or withdrew the sharing consent. */
  "withdrawn",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const UNSENT_PROPOSAL_STATUSES = ["held", "queued", "failed"] as const satisfies readonly ProposalStatus[];

/** How favourable an outcome is — a CreatorCo override may never be more favourable than the lender's decision. */
export const OUTCOME_RANK = { declined: 0, modified: 1, approved: 2 } as const;

export const HOLD_REASONS = ["fraud_review"] as const;
export const WITHDRAW_REASONS = ["inputs_changed", "consent_withdrawn", "check_closed"] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

export const DECISION_OUTCOMES = ["approved", "modified", "declined"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];
export const REVIEW_ACTIONS = ["confirm", "override"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * How a decision arrived: polled through the lender adapter (the simulated
 * lender), or posted by the partner to the partner API (Stage 12b).
 */
export const DECISION_SOURCES = ["lender_poll", "partner_api"] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

/**
 * Stage 12b user decision: a real partner's decision is the regulated
 * entity's sanction. CreatorCo staff confirm it, or raise a query the partner
 * answers with a revision — they never change it. Overrides (never more
 * favourable) remain only for the pilot's simulated lender.
 */
export const reviewActionsFor = (simulated: boolean): readonly ("confirm" | "override" | "query")[] =>
  simulated ? ["confirm", "override"] : ["confirm", "query"];

/** Stage 13: the creator's answer to a reviewed offer. */
export const OFFER_RESPONSES = ["accepted", "declined"] as const;
export type OfferResponse = (typeof OFFER_RESPONSES)[number];
export const OFFER_DECLINE_REASONS = ["no_longer_needed", "terms", "other_lender", "other"] as const;
export type OfferDeclineReason = (typeof OFFER_DECLINE_REASONS)[number];
/** The longest a partner's offer may stand (it holds the creator's data back from erasure while open). */
export const MAX_OFFER_VALIDITY_DAYS = 60;
/** What the creator sees about an offer. `expired`: not answered before `expiresAt`. */
export const OFFER_STATES = ["open", "accepted", "declined", "expired"] as const;
export type OfferState = (typeof OFFER_STATES)[number];

export const QUERY_MESSAGE_MIN = 10;
export const QUERY_MESSAGE_MAX = 500;
/** Amount and tenor bounds a partner decision must respect (the same bounds a staff review accepts). */
export const DECISION_EXPOSURE_RANGE = { min: 10_000, max: 25_00_000 } as const;
export const DECISION_TENOR_RANGE = { min: 3, max: 60 } as const;

export const POLICY_STATUSES = ["proposed", "active", "superseded", "rejected"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** A `sending` proposal older than this was interrupted (process died); it's treated as a failed attempt. */
export const SENDING_LEASE_MS = 5 * 60_000;

/** Send attempts before a proposal is marked failed (backoff between them). */
export const MAX_SEND_ATTEMPTS = 5;
export function sendRetryDelayMs(attempt: number) {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
}

/**
 * What each version of the "Share with a partner lender" consent covers. A
 * lender's proposal profile (partnership terms) may only include groups the
 * creator's granted version covers; anything more needs a new consent version.
 */
export const LENDER_SHARING_SCOPES: Record<number, readonly ProposalDataGroup[]> = {
  1: MINIMUM_PROPOSAL_PROFILE,
};

export function uncoveredGroups(profile: readonly ProposalDataGroup[], consentVersion: number): ProposalDataGroup[] {
  const covered = new Set(LENDER_SHARING_SCOPES[consentVersion] ?? []);
  return profile.filter((g) => !covered.has(g));
}
