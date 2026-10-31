/**
 * Verified brand work (Stage 18) — vocabulary. Pure (no Node/DOM/Next), so
 * native apps can reuse it. Creator-professional domain: never credit data.
 */
export const BILLED_PARTY_TYPES = ["brand", "agency", "platform"] as const;
export type BilledPartyType = (typeof BILLED_PARTY_TYPES)[number];

export const DELIVERABLE_TYPES = [
  "reel",
  "story",
  "post",
  "integrated_video",
  "dedicated_video",
  "livestream",
  "event",
  "ugc",
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const BRAND_WORK_PLATFORMS = [
  "instagram",
  "youtube",
  "x",
  "linkedin",
  "snapchat",
  "moj",
  "josh",
  "other",
] as const;

export const VISIBILITIES = ["show_on_passport", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VERIFICATION_STATUSES = ["draft", "submitted", "in_review", "needs_info", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** `not_seen` only from a bank-data match that ran with data; missing data is never `not_seen`. */
export const PAYMENT_STATUSES = ["unconfirmed", "confirmed", "not_seen"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const CONFIRMATION_METHODS = ["agency_confirmation", "remittance_advice", "aa_match"] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

/** What the creator asks for; staff record the first two, the bank-data match records the third. */
export const DOCUMENT_KINDS = ["invoice", "purchase_order", "agreement", "remittance_advice"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const SCAN_STATUSES = ["pending", "clean", "rejected"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const REVIEW_ACTIONS = [
  "assign",
  "verify",
  "second_verify",
  "request_info",
  "reject",
  "record_agency_confirmation",
  "record_remittance_advice",
  "propose_reversal",
  "approve_reversal",
  "decline_reversal",
  "resolve_brand",
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const REVERSAL_STATUSES = ["proposed", "approved", "declined"] as const;
export type ReversalStatus = (typeof REVERSAL_STATUSES)[number];

export const DIRECTORY_STATUSES = ["active", "merged"] as const;
export const MERGE_STATUSES = ["proposed", "approved", "declined"] as const;

/** Starting brand industries (reference table `brand_industries`; evolves via migrations). */
export const BRAND_INDUSTRIES = [
  ["beauty_personal_care", "Beauty & personal care"],
  ["fashion_apparel", "Fashion & apparel"],
  ["consumer_electronics", "Consumer electronics"],
  ["bfsi_fintech", "Banking, insurance & fintech"],
  ["food_beverage", "Food & beverage"],
  ["travel_hospitality", "Travel & hospitality"],
  ["automotive", "Automotive"],
  ["gaming", "Gaming"],
  ["edtech", "Education"],
  ["health_fitness", "Health & fitness"],
  ["ott_entertainment", "OTT & entertainment"],
  ["ecommerce_marketplace", "E-commerce & marketplaces"],
  ["fmcg", "FMCG"],
  ["telecom", "Telecom"],
  ["real_estate", "Real estate"],
  ["other", "Other"],
] as const;

/** Why a reviewer asks for more information or rejects (reference table `brand_work_reasons`). */
export const BRAND_WORK_REASONS = [
  ["documents_unreadable", "Documents unreadable", "We couldn't read the documents. Please upload clearer copies."],
  [
    "documents_mismatch",
    "Documents don't match the record",
    "We couldn't match the documents to the details you entered.",
  ],
  ["brand_unclear", "Brand unclear", "We couldn't tell which brand the work was for."],
  ["dates_inconsistent", "Dates inconsistent", "The dates on the documents don't line up with the record."],
  ["amount_mismatch", "Amount doesn't match", "The amount you entered doesn't match the documents."],
  ["not_creator_work", "Not creator work", "This doesn't look like creator work for a brand."],
  ["duplicate", "Duplicate of another record", "This looks like a record you've already added."],
  ["suspected_fraud", "Integrity concern", "We couldn't verify this record."],
  ["other", "Other", "We couldn't verify this record. Please check the details and documents."],
] as const;
export type BrandWorkReason = (typeof BRAND_WORK_REASONS)[number][0];

/** Upload limits (§2). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_RECORD = 5;
export const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** A reviewer's lock on a record lapses after this, so a queue item is never stuck. */
export const ASSIGNMENT_TIMEOUT_MINUTES = 30;
/** Proposed queue SLA (for Aman to confirm): age badge after 48 hours. */
export const REVIEW_SLA_HOURS = 48;
