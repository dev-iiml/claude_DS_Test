import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  CLAIM_STATUSES,
  IDENTIFIER_TYPES,
  MAX_DAILY_UNLOCK_QUOTA,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  ORG_STATUSES,
  ORG_TYPES,
  REVIEW_ACTIONS,
  REVIEW_TARGETS,
} from "@/modules/brand-orgs/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { brandDirectory } from "./brand-work";
import { users } from "./identity";

/**
 * Verified brand and agency organisations (Stage 19) — professional domain,
 * never `fin`. GSTIN is restricted (it embeds a PAN): only a keyed
 * fingerprint and the 2-digit state code are kept, never the value.
 */

export const brandOrgs = pgTable(
  "brand_orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legalName: text("legal_name").notNull(),
    orgType: text("org_type", { enum: ORG_TYPES }).notNull(),
    website: text("website").notNull(),
    emailDomain: text("email_domain").notNull(),
    identifierType: text("identifier_type", { enum: IDENTIFIER_TYPES }).notNull(),
    /** A public MCA identifier (CIN or LLPIN). */
    identifierValue: text("identifier_value").notNull(),
    gstinFingerprint: text("gstin_fingerprint"),
    gstinStateCode: text("gstin_state_code"),
    status: text("status", { enum: ORG_STATUSES }).notNull().default("pending"),
    /** Company lookup result (public registry data): legal name, status, incorporation date. */
    lookupLegalName: text("lookup_legal_name"),
    lookupStatus: text("lookup_status"),
    lookupIncorporatedOn: date("lookup_incorporated_on", { mode: "string" }),
    lookupProvider: text("lookup_provider"),
    lookupAt: timestamp("lookup_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** A pending suspension or reinstatement awaiting a second admin. */
    pendingAction: text("pending_action"),
    pendingBy: uuid("pending_by").references(() => users.id, { onDelete: "set null" }),
    /** Per-organisation override, within the /ops limit. Null = the /ops default. */
    dailyUnlockQuota: integer("daily_unlock_quota"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("brand_orgs_identifier_key").on(t.identifierType, t.identifierValue),
    index("brand_orgs_status_idx").on(t.status),
    check("brand_orgs_type_valid", sql`${t.orgType} in (${sqlInList(ORG_TYPES)})`),
    check("brand_orgs_status_valid", sql`${t.status} in (${sqlInList(ORG_STATUSES)})`),
    check("brand_orgs_identifier_type_valid", sql`${t.identifierType} in (${sqlInList(IDENTIFIER_TYPES)})`),
    check(
      "brand_orgs_identifier_format",
      sql`(${t.identifierType} = 'cin' and ${t.identifierValue} ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$')
        or (${t.identifierType} = 'llpin' and ${t.identifierValue} ~ '^[A-Z]{3}-[0-9]{4}$')`,
    ),
    check("brand_orgs_legal_name_length", sql`char_length(${t.legalName}) between 2 and 120`),
    check("brand_orgs_website_format", sql`${t.website} ~ '^https?://' and char_length(${t.website}) <= 200`),
    check("brand_orgs_domain_format", sql`${t.emailDomain} ~ '^[a-z0-9.-]+\\.[a-z]{2,}$'`),
    // Never a GSTIN: a keyed fingerprint and the state code only.
    check(
      "brand_orgs_gstin_shape",
      sql`(${t.gstinFingerprint} is null) = (${t.gstinStateCode} is null)
        and (${t.gstinFingerprint} is null or ${t.gstinFingerprint} ~ '^g1:[0-9a-f]{32}$')
        and (${t.gstinStateCode} is null or ${t.gstinStateCode} ~ '^[0-9]{2}$')`,
    ),
    // Four eyes: verified only after a different admin approves.
    check(
      "brand_orgs_four_eyes",
      sql`${t.approvedBy} is null or (${t.verifiedBy} is not null and ${t.approvedBy} <> ${t.verifiedBy})`,
    ),
    check("brand_orgs_verified_shape", sql`${t.status} <> 'verified' or ${t.approvedBy} is not null`),
    check(
      "brand_orgs_pending_action_valid",
      sql`${t.pendingAction} is null or ${t.pendingAction} in ('suspend', 'reinstate')`,
    ),
    check(
      "brand_orgs_quota_bound",
      sql`${t.dailyUnlockQuota} is null or ${t.dailyUnlockQuota} between 0 and ${sql.raw(String(MAX_DAILY_UNLOCK_QUOTA))}`,
    ),
  ],
).enableRLS();

export const brandOrgMembers = pgTable(
  "brand_org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => brandOrgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgRole: text("org_role", { enum: MEMBER_ROLES }).notNull(),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("active"),
    termsVersion: integer("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("brand_org_members_user_key").on(t.userId),
    index("brand_org_members_org_idx").on(t.orgId),
    check("brand_org_members_role_valid", sql`${t.orgRole} in (${sqlInList(MEMBER_ROLES)})`),
    check("brand_org_members_status_valid", sql`${t.status} in (${sqlInList(MEMBER_STATUSES)})`),
    check("brand_org_members_terms_shape", sql`(${t.termsVersion} is null) = (${t.termsAcceptedAt} is null)`),
  ],
).enableRLS();

/** An owner invites a colleague from the same email domain. Only a hash of the link token is kept. */
export const brandOrgInvites = pgTable(
  "brand_org_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => brandOrgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("brand_org_invites_token_key").on(t.tokenHash),
    index("brand_org_invites_org_idx").on(t.orgId),
    check("brand_org_invites_token_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
).enableRLS();

/** Work-email one-time codes before an organisation account exists. Hash of the code only; purged after a day. */
export const brandEmailChallenges = pgTable(
  "brand_email_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("brand_email_challenges_email_idx").on(t.email, t.createdAt),
    check("brand_email_challenges_hash_format", sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
  ],
).enableRLS();

/** A brand directory entry an organisation claims, and its logo. Each needs a verifier and a different approver. */
export const brandOrgClaims = pgTable(
  "brand_org_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => brandOrgs.id, { onDelete: "cascade" }),
    directoryId: uuid("directory_id")
      .notNull()
      .references(() => brandDirectory.id, { onDelete: "cascade" }),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("pending"),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    logoKey: text("logo_key"),
    logoMime: text("logo_mime"),
    logoProvider: text("logo_provider"),
    logoScan: text("logo_scan"),
    logoStatus: text("logo_status", { enum: CLAIM_STATUSES }),
    logoVerifiedBy: uuid("logo_verified_by").references(() => users.id, { onDelete: "set null" }),
    logoApprovedBy: uuid("logo_approved_by").references(() => users.id, { onDelete: "set null" }),
    /** "We own or are authorised to use this logo" — ticked by the member who uploaded it. */
    logoLicenceAcceptedBy: uuid("logo_licence_accepted_by").references(() => users.id, { onDelete: "set null" }),
    logoLicenceAcceptedAt: timestamp("logo_licence_accepted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("brand_org_claims_org_idx").on(t.orgId),
    // One approved claim per directory brand.
    uniqueIndex("brand_org_claims_directory_approved_key")
      .on(t.directoryId)
      .where(sql`${t.status} = 'approved'`),
    check("brand_org_claims_status_valid", sql`${t.status} in (${sqlInList(CLAIM_STATUSES)})`),
    check(
      "brand_org_claims_logo_status_valid",
      sql`${t.logoStatus} is null or ${t.logoStatus} in (${sqlInList(CLAIM_STATUSES)})`,
    ),
    check("brand_org_claims_logo_key_format", sql`${t.logoKey} is null or ${t.logoKey} ~ '^lg/[0-9a-f]{32}$'`),
    check(
      "brand_org_claims_logo_scan_valid",
      sql`${t.logoScan} is null or ${t.logoScan} in ('pending', 'clean', 'rejected')`,
    ),
    check(
      "brand_org_claims_logo_shape",
      sql`(${t.logoKey} is null) = (${t.logoStatus} is null)
        and (${t.logoKey} is null) = (${t.logoProvider} is null)
        and (${t.logoKey} is null or (${t.logoLicenceAcceptedBy} is not null and ${t.logoLicenceAcceptedAt} is not null))`,
    ),
    check(
      "brand_org_claims_four_eyes",
      sql`(${t.approvedBy} is null or (${t.verifiedBy} is not null and ${t.approvedBy} <> ${t.verifiedBy}))
        and (${t.logoApprovedBy} is null or (${t.logoVerifiedBy} is not null and ${t.logoApprovedBy} <> ${t.logoVerifiedBy}))`,
    ),
  ],
).enableRLS();

/** Append-only staff decisions on organisations, claims and logos (reason codes, never free text). */
export const brandOrgReviews = pgTable(
  "brand_org_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => brandOrgs.id, { onDelete: "cascade" }),
    target: text("target", { enum: REVIEW_TARGETS }).notNull(),
    targetId: uuid("target_id").notNull(),
    action: text("action", { enum: REVIEW_ACTIONS }).notNull(),
    reasonCode: text("reason_code"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("brand_org_reviews_org_idx").on(t.orgId, t.createdAt),
    check("brand_org_reviews_target_valid", sql`${t.target} in (${sqlInList(REVIEW_TARGETS)})`),
    check("brand_org_reviews_action_valid", sql`${t.action} in (${sqlInList(REVIEW_ACTIONS)})`),
    check("brand_org_reviews_reason_format", sql`${t.reasonCode} is null or ${t.reasonCode} ~ '^[a-z_]{2,40}$'`),
  ],
).enableRLS();

export type BrandOrgRow = typeof brandOrgs.$inferSelect;
