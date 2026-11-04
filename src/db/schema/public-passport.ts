import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ACCESS_LOG_KINDS,
  BIO_MAX,
  CODE_MAX_USES_LIMIT,
  PASSPORT_STATUSES,
  REPORT_REASON_CODES,
  REPORT_STATUSES,
  TAKEDOWN_STATUSES,
  UNLOCK_AUDIENCES,
} from "@/modules/public-passport/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { brandOrgs } from "./brand-orgs";
import { creatorProfiles } from "./creator-profile";
import { users } from "./identity";

/**
 * Verified Creator Passport (Stage 19) — professional domain only. The page is
 * assembled at request time from the creator's own professional data; these
 * tables hold the creator's sharing choices, access codes (hashed), the access
 * log (ids, day and hour, an IP pseudonym — never a raw IP) and moderation.
 */

export const publicPassports = pgTable(
  "public_passports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug"),
    status: text("status", { enum: PASSPORT_STATUSES }).notNull().default("draft"),
    /** Per-field tiers, normalised by `normaliseFieldTiers` on every read and write. */
    fieldTiers: jsonb("field_tiers").$type<Record<string, string>>().notNull().default({}),
    bio: text("bio"),
    photoKey: text("photo_key"),
    photoMime: text("photo_mime"),
    /** The storage config key holding the photo (vendor-neutral). */
    photoProvider: text("photo_provider"),
    photoScan: text("photo_scan"),
    audience: text("audience", { enum: UNLOCK_AUDIENCES }).notNull().default("code_holders_only"),
    indexable: boolean("indexable").notNull().default(false),
    includePrivateInTotals: boolean("include_private_in_totals").notNull().default(false),
    discoverable: boolean("discoverable").notNull().default(false),
    /** Bumped by every change that alters what the page shows, so cached locked renders are never reused. */
    cacheVersion: integer("cache_version").notNull().default(1),
    codeFailures: integer("code_failures").notNull().default(0),
    codeFailuresSince: timestamp("code_failures_since", { withTimezone: true }),
    codeLockedUntil: timestamp("code_locked_until", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("public_passports_creator_key").on(t.creatorId),
    uniqueIndex("public_passports_slug_key").on(t.slug),
    check("public_passports_status_valid", sql`${t.status} in (${sqlInList(PASSPORT_STATUSES)})`),
    check("public_passports_audience_valid", sql`${t.audience} in (${sqlInList(UNLOCK_AUDIENCES)})`),
    check(
      "public_passports_slug_format",
      sql`${t.slug} is null or (${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' and ${t.slug} !~ '--')`,
    ),
    check("public_passports_published_shape", sql`${t.status} <> 'published' or ${t.slug} is not null`),
    check(
      "public_passports_tiers_shape",
      sql`jsonb_typeof(${t.fieldTiers}) = 'object' and pg_column_size(${t.fieldTiers}) <= 1024`,
    ),
    check("public_passports_bio_length", sql`${t.bio} is null or char_length(${t.bio}) <= ${sql.raw(String(BIO_MAX))}`),
    check("public_passports_photo_key_format", sql`${t.photoKey} is null or ${t.photoKey} ~ '^pp/[0-9a-f]{32}$'`),
    check(
      "public_passports_photo_shape",
      sql`(${t.photoKey} is null) = (${t.photoScan} is null) and (${t.photoKey} is null) = (${t.photoMime} is null)
        and (${t.photoKey} is null) = (${t.photoProvider} is null)`,
    ),
    check(
      "public_passports_photo_scan_valid",
      sql`${t.photoScan} is null or ${t.photoScan} in ('pending', 'clean', 'rejected')`,
    ),
    // Discoverability is only meaningful when verified brands are part of the audience.
    check(
      "public_passports_discoverable_shape",
      sql`not ${t.discoverable} or ${t.audience} = 'code_holders_and_verified_brands'`,
    ),
  ],
).enableRLS();

/** A changed link keeps redirecting for 30 days, then the old slug is free again. */
export const publicPassportSlugRedirects = pgTable(
  "public_passport_slug_redirects",
  {
    slug: text("slug").primaryKey(),
    passportId: uuid("passport_id")
      .notNull()
      .references(() => publicPassports.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("public_passport_slug_redirects_passport_idx").on(t.passportId),
    check("public_passport_slug_redirects_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'`),
  ],
).enableRLS();

/** Creator-issued access codes. Only a SHA-256 hash and the last 4 characters (for recognition) are kept. */
export const passportAccessCodes = pgTable(
  "passport_access_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportId: uuid("passport_id")
      .notNull()
      .references(() => publicPassports.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    codeHash: text("code_hash").notNull(),
    codeHint: text("code_hint").notNull(),
    /** Optional: only members of this verified organisation can use the code. */
    orgId: uuid("org_id").references(() => brandOrgs.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("passport_access_codes_hash_key").on(t.codeHash),
    index("passport_access_codes_passport_idx").on(t.passportId),
    check("passport_access_codes_hash_format", sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    check("passport_access_codes_hint_format", sql`${t.codeHint} ~ '^[0-9A-Z]{4}$'`),
    check("passport_access_codes_label_length", sql`char_length(${t.label}) between 1 and 60`),
    check(
      "passport_access_codes_max_uses_bound",
      sql`${t.maxUses} is null or ${t.maxUses} between 1 and ${sql.raw(String(CODE_MAX_USES_LIMIT))}`,
    ),
    check(
      "passport_access_codes_uses_bound",
      sql`${t.uses} >= 0 and (${t.maxUses} is null or ${t.uses} <= ${t.maxUses})`,
    ),
  ],
).enableRLS();

/**
 * Who unlocked the creator's passport. Shown to the creator. Ids, the code's
 * label, the India day and hour, the viewer's own (unverified) name/company if
 * given, or a verified organisation id. An IP pseudonym — never the IP.
 * Append-only; kept until account erasure.
 */
export const passportAccessLog = pgTable(
  "passport_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportId: uuid("passport_id")
      .notNull()
      .references(() => publicPassports.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ACCESS_LOG_KINDS }).notNull(),
    codeId: uuid("code_id").references(() => passportAccessCodes.id, { onDelete: "set null" }),
    codeLabel: text("code_label"),
    orgId: uuid("org_id").references(() => brandOrgs.id, { onDelete: "set null" }),
    viewerName: text("viewer_name"),
    viewerCompany: text("viewer_company"),
    ipPseudonym: text("ip_pseudonym"),
    day: date("day", { mode: "string" }).notNull(),
    hour: smallint("hour").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("passport_access_log_passport_idx").on(t.passportId, t.createdAt),
    index("passport_access_log_org_day_idx").on(t.orgId, t.day),
    check("passport_access_log_kind_valid", sql`${t.kind} in (${sqlInList(ACCESS_LOG_KINDS)})`),
    check("passport_access_log_hour_bound", sql`${t.hour} between 0 and 23`),
    check("passport_access_log_ip_format", sql`${t.ipPseudonym} is null or ${t.ipPseudonym} ~ '^ip1:[0-9a-f]{32}$'`),
    check("passport_access_log_name_length", sql`${t.viewerName} is null or char_length(${t.viewerName}) <= 60`),
    check(
      "passport_access_log_company_length",
      sql`${t.viewerCompany} is null or char_length(${t.viewerCompany}) <= 80`,
    ),
    check("passport_access_log_shape", sql`${t.kind} <> 'brand' or ${t.orgId} is not null`),
  ],
).enableRLS();

/** "Report this page": ids and a reason code only. */
export const passportReports = pgTable(
  "passport_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportId: uuid("passport_id")
      .notNull()
      .references(() => publicPassports.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: REPORT_REASON_CODES }).notNull(),
    status: text("status", { enum: REPORT_STATUSES }).notNull().default("open"),
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("passport_reports_status_idx").on(t.status, t.createdAt),
    check("passport_reports_reason_valid", sql`${t.reason} in (${sqlInList(REPORT_REASON_CODES)})`),
    check("passport_reports_status_valid", sql`${t.status} in (${sqlInList(REPORT_STATUSES)})`),
  ],
).enableRLS();

/** Staff take a passport offline pending review; making it permanent needs a second admin. */
export const passportTakedowns = pgTable(
  "passport_takedowns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportId: uuid("passport_id")
      .notNull()
      .references(() => publicPassports.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: REPORT_REASON_CODES }).notNull(),
    status: text("status", { enum: TAKEDOWN_STATUSES }).notNull().default("offline"),
    takenBy: uuid("taken_by").references(() => users.id, { onDelete: "set null" }),
    proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    liftedBy: uuid("lifted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("passport_takedowns_passport_idx").on(t.passportId),
    uniqueIndex("passport_takedowns_active_key")
      .on(t.passportId)
      .where(sql`${t.status} in ('offline', 'permanent_proposed', 'permanent')`),
    check("passport_takedowns_status_valid", sql`${t.status} in (${sqlInList(TAKEDOWN_STATUSES)})`),
    check("passport_takedowns_reason_valid", sql`${t.reason} in (${sqlInList(REPORT_REASON_CODES)})`),
    check(
      "passport_takedowns_four_eyes",
      sql`(${t.status} <> 'permanent' or (${t.proposedBy} is not null and ${t.approvedBy} is not null))
        and (${t.approvedBy} is null or ${t.approvedBy} <> ${t.proposedBy})`,
    ),
  ],
).enableRLS();
