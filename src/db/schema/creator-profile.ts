import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  DEFAULT_COUNTRY,
  GST_REGISTRATION_SOURCES,
  GST_REGISTRATION_STATUSES,
  GST_STATUSES,
  LEGAL_FORMS,
  LEGAL_NAME_SOURCES,
  ONBOARDING_STEPS,
  PROFILE_STATUSES,
} from "@/modules/creator-profile/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { users } from "./identity";

/**
 * Creator categories evolve with the business, so they live in a reference
 * table rather than a hard-coded enum (CLAUDE.md §29.16).
 */
export const creatorCategories = pgTable(
  "creator_categories",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check("creator_categories_code_format", sql`${t.code} ~ '^[a-z][a-z0-9_]{0,39}$'`)],
).enableRLS();

export const creatorProfiles = pgTable(
  "creator_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    legalName: text("legal_name").notNull(),
    /** Whether the legal name was typed by the creator or matches a verified identity lookup. */
    legalNameSource: text("legal_name_source", { enum: LEGAL_NAME_SOURCES }).notNull().default("self_declared"),
    displayName: text("display_name").notNull(),
    primaryCreatorHandle: text("primary_creator_handle"),
    /** Primary category. Nullable while in draft; required once completed (see CHECK). Up to two more live in `creator_additional_categories`. */
    creatorCategory: text("creator_category").references(() => creatorCategories.code),
    city: text("city"),
    state: text("state"),
    country: text("country").notNull().default(DEFAULT_COUNTRY),
    languages: text("languages")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Languages typed by the creator that are not in the reference list. */
    languagesOther: text("languages_other")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** First day of the month the creator began creating professionally. */
    creatorSince: date("creator_since", { mode: "string" }),
    legalForm: text("legal_form", { enum: LEGAL_FORMS }),
    gstStatus: text("gst_status", { enum: GST_STATUSES }),
    /**
     * Restricted field: a GSTIN embeds the holder's PAN. Never log it, never put
     * it in audit metadata or analytics. Retention to be confirmed by counsel.
     */
    gstin: text("gstin"),
    profileStatus: text("profile_status", { enum: PROFILE_STATUSES }).notNull().default("draft"),
    lastCompletedStep: text("last_completed_step", { enum: ONBOARDING_STEPS }).notNull().default("about"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Set while membership is paused (Creator Profile consent withdrawn). */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("creator_profiles_user_id_key").on(t.userId),
    index("creator_profiles_category_idx").on(t.creatorCategory),
    index("creator_profiles_gst_status_idx").on(t.gstStatus),
    index("creator_profiles_profile_status_idx").on(t.profileStatus),
    // Not unique: the same handle can exist on different platforms. Duplicate
    // claims are a fraud-review signal (Stage 11), not a hard block.
    index("creator_profiles_primary_handle_idx").on(sql`lower(${t.primaryCreatorHandle})`),
    check("creator_profiles_legal_name_length", sql`char_length(btrim(${t.legalName})) between 2 and 120`),
    check("creator_profiles_display_name_length", sql`char_length(btrim(${t.displayName})) between 1 and 60`),
    check(
      "creator_profiles_handle_format",
      sql`${t.primaryCreatorHandle} is null or ${t.primaryCreatorHandle} ~ '^[A-Za-z0-9._-]{2,64}$'`,
    ),
    check("creator_profiles_languages_other_bound", sql`cardinality(${t.languagesOther}) <= 5`),
    check("creator_profiles_legal_name_source_valid", sql`${t.legalNameSource} in (${sqlInList(LEGAL_NAME_SOURCES)})`),
    check("creator_profiles_country_format", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check(
      "creator_profiles_legal_form_valid",
      sql`${t.legalForm} is null or ${t.legalForm} in (${sqlInList(LEGAL_FORMS)})`,
    ),
    check(
      "creator_profiles_gst_status_valid",
      sql`${t.gstStatus} is null or ${t.gstStatus} in (${sqlInList(GST_STATUSES)})`,
    ),
    // GSTIN may only be present when the creator declares GST registration.
    check("creator_profiles_gstin_requires_registration", sql`${t.gstin} is null or ${t.gstStatus} = 'registered'`),
    check(
      "creator_profiles_gstin_format",
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check("creator_profiles_profile_status_valid", sql`${t.profileStatus} in (${sqlInList(PROFILE_STATUSES)})`),
    check("creator_profiles_last_step_valid", sql`${t.lastCompletedStep} in (${sqlInList(ONBOARDING_STEPS)})`),
    check(
      "creator_profiles_creator_since_floor",
      sql`${t.creatorSince} is null or ${t.creatorSince} >= date '2000-01-01'`,
    ),
    check(
      "creator_profiles_paused_state",
      sql`(${t.profileStatus} = 'paused') = (${t.pausedAt} is not null)
        and (${t.profileStatus} <> 'paused' or ${t.completedAt} is not null)`,
    ),
    // A completed profile must carry every field the pilot relies on.
    check(
      "creator_profiles_completed_is_whole",
      sql`${t.profileStatus} <> 'completed' or (
        ${t.creatorCategory} is not null
        and ${t.legalForm} is not null
        and ${t.gstStatus} is not null
        and ${t.lastCompletedStep} = 'consent'
        and ${t.completedAt} is not null
      )`,
    ),
  ],
).enableRLS();

export const creatorPreferences = pgTable(
  "creator_preferences",
  {
    creatorId: uuid("creator_id")
      .primaryKey()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    /** PR categories the creator wants to receive. Codes from `creator_categories`. */
    preferredCategories: text("preferred_categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Brand categories the creator wants to work with. Codes from `creator_categories`. */
    brandInterests: text("brand_interests")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Interest in travel and event invitations. */
    travelInterest: boolean("travel_interest").notNull().default(false),
    prInterest: boolean("pr_interest").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("creator_preferences_preferred_categories_bound", sql`cardinality(${t.preferredCategories}) <= 20`),
    check("creator_preferences_brand_interests_bound", sql`cardinality(${t.brandInterests}) <= 20`),
  ],
).enableRLS();

/** Secondary categories (max two, enforced by the onboarding service). The primary stays on `creator_profiles`. */
export const creatorAdditionalCategories = pgTable(
  "creator_additional_categories",
  {
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    categoryCode: text("category_code")
      .notNull()
      .references(() => creatorCategories.code),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.creatorId, t.categoryCode] })],
).enableRLS();

/**
 * GST registration details confirmed through a tax-registration provider.
 * Restricted: the GSTIN embeds the PAN. Only registrations the creator chose
 * are stored; other candidates returned by a lookup are discarded.
 */
export const creatorGstRegistrations = pgTable(
  "creator_gst_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    gstin: text("gstin").notNull(),
    registrationStatus: text("registration_status", { enum: GST_REGISTRATION_STATUSES }).notNull(),
    legalName: text("legal_name"),
    tradeName: text("trade_name"),
    /** "Constitution of business" as reported by the registry, e.g. Proprietorship. */
    constitution: text("constitution"),
    stateCode: text("state_code"),
    registeredOn: date("registered_on", { mode: "string" }),
    source: text("source", { enum: GST_REGISTRATION_SOURCES }).notNull(),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("creator_gst_registrations_creator_gstin_key").on(t.creatorId, t.gstin),
    check(
      "creator_gst_registrations_gstin_format",
      sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check(
      "creator_gst_registrations_status_valid",
      sql`${t.registrationStatus} in (${sqlInList(GST_REGISTRATION_STATUSES)})`,
    ),
    check("creator_gst_registrations_source_valid", sql`${t.source} in (${sqlInList(GST_REGISTRATION_SOURCES)})`),
  ],
).enableRLS();
