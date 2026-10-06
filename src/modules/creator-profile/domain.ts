/**
 * Creator-profile vocabulary.
 *
 * Legal form and GST registration status are deliberately independent fields.
 * Nothing in this module infers a GST obligation from legal form, income or
 * any other attribute — CreatorCo records what the creator declares.
 */
export const LEGAL_FORMS = [
  "individual",
  "sole_proprietorship",
  "partnership",
  "llp",
  "private_limited",
  "one_person_company",
  "other_entity",
] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

/** Legal forms accepted in the current (Cohort A0) pilot. */
export const PILOT_SUPPORTED_LEGAL_FORMS = [
  "individual",
  "sole_proprietorship",
] as const satisfies readonly LegalForm[];

export const GST_STATUSES = ["not_registered", "registered", "unknown_requires_review"] as const;
export type GstStatus = (typeof GST_STATUSES)[number];

/**
 * `paused`: the creator withdrew their Creator Profile consent. Nothing is
 * processed; data is kept and membership resumes when they consent again.
 * `suspended` is reserved for staff action.
 */
export const PROFILE_STATUSES = ["draft", "completed", "paused", "suspended"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/**
 * Persisted onboarding steps, in order. "welcome" is presentational and is not
 * persisted; the profile row is created when "about" is first saved.
 */
export const ONBOARDING_STEPS = ["about", "profile", "business", "interests", "consent"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const DEFAULT_COUNTRY = "IN";

export const LEGAL_NAME_SOURCES = ["self_declared", "verified_lookup"] as const;
export type LegalNameSource = (typeof LEGAL_NAME_SOURCES)[number];

/** Registry status of a GSTIN as reported by a tax-registration provider. */
export const GST_REGISTRATION_STATUSES = ["active", "suspended", "cancelled", "not_found"] as const;
export type GstRegistrationStatus = (typeof GST_REGISTRATION_STATUSES)[number];

export const GST_REGISTRATION_SOURCES = ["lookup_by_pan", "manual_entry"] as const;
export type GstRegistrationSource = (typeof GST_REGISTRATION_SOURCES)[number];

export const MAX_CATEGORIES = 3;
export const MAX_OTHER_LANGUAGES = 5;
