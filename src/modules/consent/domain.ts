/** Consent vocabulary. Each purpose has its own key; there is no blanket consent. */
export const CONSENT_KEYS = {
  creatorProfile: "creator_profile",
  identityPrefill: "identity_prefill",
  socialAccountConnection: "social_account_connection",
  professionalAnalytics: "professional_analytics",
  financialEligibility: "financial_eligibility",
  lenderSharing: "lender_sharing",
  lenderHandoff: "lender_handoff",
  brandOpportunities: "brand_opportunities",
  productAnalytics: "product_analytics",
} as const;
export type ConsentKey = (typeof CONSENT_KEYS)[keyof typeof CONSENT_KEYS];

export const CONSENT_STATUSES = ["granted", "withdrawn"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_SOURCES = ["onboarding", "settings", "api", "system"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Optional reason a creator gives when withdrawing (never free text). */
export const WITHDRAWAL_REASONS = ["not_using", "privacy", "too_much_data", "other"] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

/** Data a withdrawal can require us to erase. */
export const ERASURE_SCOPES = [
  "social_account_data",
  "professional_graph",
  "identity_lookup",
  "financial_inputs",
  "access_requests",
  "product_analytics_events",
  "financial_funnel_events",
] as const;
export type ErasureScope = (typeof ERASURE_SCOPES)[number];

/**
 * `completed`: erased. `deferred`: processing stopped, but erasure waits for a
 * retention hold (e.g. an open credit relationship with a partner lender) to lift.
 */
export const ERASURE_STATUSES = ["completed", "deferred"] as const;
export type ErasureStatus = (typeof ERASURE_STATUSES)[number];
