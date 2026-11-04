import { sql } from "drizzle-orm";
import {
  bigint,
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
  BILLED_PARTY_TYPES,
  CONFIRMATION_METHODS,
  DIRECTORY_STATUSES,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  MERGE_STATUSES,
  PAYMENT_STATUSES,
  REVERSAL_STATUSES,
  REVIEW_ACTIONS,
  SCAN_STATUSES,
  VERIFICATION_STATUSES,
  VISIBILITIES,
} from "@/modules/brand-work/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { consentReceipts } from "./consent";
import { creatorProfiles } from "./creator-profile";
import { users } from "./identity";

/**
 * Verified brand work (Stage 18) — creator-professional domain. Records of a
 * creator's collaborations with brands, backed by documents CreatorCo staff
 * verify. NEVER credit data: no underwriting, eligibility, lending or Creator
 * Status module reads these tables (a unit test enforces it).
 *
 * Restricted content: invoices can carry PAN, GSTIN, bank details and
 * addresses. Those exist ONLY in the stored document bytes — never in columns,
 * logs, audit metadata, analytics or form state.
 */

// ── Reference data ─────────────────────────────────────────────────────────

export const brandIndustries = pgTable("brand_industries", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
}).enableRLS();

/** Reasons for "needs info", rejection and reversal. Staff label + a neutral creator-facing message. */
export const brandWorkReasons = pgTable("brand_work_reasons", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  creatorMessage: text("creator_message").notNull(),
  sortOrder: integer("sort_order").notNull(),
}).enableRLS();

// ── Brand directory (entity resolution) ────────────────────────────────────

/** Canonical brands. Separate from the Access preview's fictional `brands`. Merged entries point to the survivor. */
export const brandDirectory = pgTable(
  "brand_directory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    industryCode: text("industry_code")
      .notNull()
      .references(() => brandIndustries.code, { onDelete: "restrict" }),
    status: text("status", { enum: DIRECTORY_STATUSES }).notNull().default("active"),
    mergedInto: uuid("merged_into"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("brand_directory_status_valid", sql`${t.status} in (${sqlInList(DIRECTORY_STATUSES)})`),
    check("brand_directory_name_length", sql`char_length(${t.canonicalName}) between 2 and 80`),
    check("brand_directory_merge_shape", sql`(${t.status} = 'merged') = (${t.mergedInto} is not null)`),
  ],
).enableRLS();

/** Normalised alias → directory brand ("nykaa fashion" → Nykaa Fashion). */
export const brandAliases = pgTable(
  "brand_aliases",
  {
    alias: text("alias").primaryKey(),
    directoryId: uuid("directory_id")
      .notNull()
      .references(() => brandDirectory.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("brand_aliases_directory_idx").on(t.directoryId),
    check("brand_aliases_format", sql`${t.alias} ~ '^[a-z0-9 ]{1,80}$'`),
  ],
).enableRLS();

/** Four eyes: one reviewer proposes merging `fromId` into `intoId`; another approves. */
export const brandDirectoryMerges = pgTable(
  "brand_directory_merges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromId: uuid("from_id")
      .notNull()
      .references(() => brandDirectory.id, { onDelete: "restrict" }),
    intoId: uuid("into_id")
      .notNull()
      .references(() => brandDirectory.id, { onDelete: "restrict" }),
    status: text("status", { enum: MERGE_STATUSES }).notNull().default("proposed"),
    proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    check("brand_directory_merges_status_valid", sql`${t.status} in (${sqlInList(MERGE_STATUSES)})`),
    check("brand_directory_merges_distinct", sql`${t.fromId} <> ${t.intoId}`),
    check("brand_directory_merges_four_eyes", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.proposedBy}`),
    uniqueIndex("brand_directory_merges_open_key")
      .on(t.fromId)
      .where(sql`${t.status} = 'proposed'`),
  ],
).enableRLS();

// ── Records ────────────────────────────────────────────────────────────────

export const brandWorkRecords = pgTable(
  "brand_work_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The brand the work was for, as the creator typed it. */
    endBrandName: text("end_brand_name").notNull(),
    /** Resolved by a reviewer (or an alias match). */
    brandDirectoryId: uuid("brand_directory_id").references(() => brandDirectory.id, { onDelete: "restrict" }),
    billedPartyType: text("billed_party_type", { enum: BILLED_PARTY_TYPES }).notNull(),
    billedPartyName: text("billed_party_name").notNull(),
    /** Suggested by the creator, confirmed by the reviewer. */
    industryCode: text("industry_code").references(() => brandIndustries.code, { onDelete: "restrict" }),
    industryConfirmed: boolean("industry_confirmed").notNull().default(false),
    platforms: text("platforms").array().notNull(),
    deliverables: text("deliverables").array().notNull(),
    visibility: text("visibility", { enum: VISIBILITIES }).notNull().default("show_on_passport"),
    description: text("description").notNull(),
    deliverablesSummary: text("deliverables_summary"),
    workDate: date("work_date", { mode: "string" }).notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }),
    /** Integer paise. Professional-domain business data; never used for affordability. */
    invoiceAmountPaise: bigint("invoice_amount_paise", { mode: "number" }),
    currency: text("currency").notNull().default("INR"),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES }).notNull().default("draft"),
    paymentStatus: text("payment_status", { enum: PAYMENT_STATUSES }).notNull().default("unconfirmed"),
    paymentConfirmationMethod: text("payment_confirmation_method", { enum: CONFIRMATION_METHODS }),
    paymentConfirmedMonth: date("payment_confirmed_month", { mode: "string" }),
    /** How the creator asked for the payment to be confirmed (all options are equal; points don't depend on it). */
    requestedConfirmation: text("requested_confirmation", { enum: CONFIRMATION_METHODS }),
    /** Pure-rule flags at submission/review (codes only). */
    flags: text("flags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rulesVersion: text("rules_version"),
    /** Latest reason shown to the creator (needs info / rejected), from `brand_work_reasons`. */
    reasonCode: text("reason_code").references(() => brandWorkReasons.code, { onDelete: "restrict" }),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    assignedUntil: timestamp("assigned_until", { withTimezone: true }),
    firstReviewerId: uuid("first_reviewer_id").references(() => users.id, { onDelete: "set null" }),
    secondReviewerId: uuid("second_reviewer_id").references(() => users.id, { onDelete: "set null" }),
    consentReceiptId: uuid("consent_receipt_id")
      .notNull()
      .references(() => consentReceipts.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    paymentConfirmedAt: timestamp("payment_confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("brand_work_records_creator_idx").on(t.creatorId, t.workDate.desc()),
    index("brand_work_records_queue_idx").on(t.verificationStatus, t.submittedAt),
    index("brand_work_records_directory_idx").on(t.brandDirectoryId),
    check("brand_work_records_status_valid", sql`${t.verificationStatus} in (${sqlInList(VERIFICATION_STATUSES)})`),
    check("brand_work_records_payment_valid", sql`${t.paymentStatus} in (${sqlInList(PAYMENT_STATUSES)})`),
    check(
      "brand_work_records_method_valid",
      sql`${t.paymentConfirmationMethod} is null or ${t.paymentConfirmationMethod} in (${sqlInList(CONFIRMATION_METHODS)})`,
    ),
    check(
      "brand_work_records_requested_valid",
      sql`${t.requestedConfirmation} is null or ${t.requestedConfirmation} in (${sqlInList(CONFIRMATION_METHODS)})`,
    ),
    check("brand_work_records_billed_valid", sql`${t.billedPartyType} in (${sqlInList(BILLED_PARTY_TYPES)})`),
    check("brand_work_records_visibility_valid", sql`${t.visibility} in (${sqlInList(VISIBILITIES)})`),
    check("brand_work_records_currency", sql`${t.currency} = 'INR'`),
    check(
      "brand_work_records_amount_range",
      sql`${t.invoiceAmountPaise} is null or ${t.invoiceAmountPaise} between 1 and 1000000000000`,
    ),
    check("brand_work_records_brand_length", sql`char_length(${t.endBrandName}) between 2 and 80`),
    check("brand_work_records_billed_length", sql`char_length(${t.billedPartyName}) between 2 and 80`),
    check("brand_work_records_description_length", sql`char_length(${t.description}) between 3 and 280`),
    check(
      "brand_work_records_summary_length",
      sql`${t.deliverablesSummary} is null or char_length(${t.deliverablesSummary}) <= 280`,
    ),
    check(
      "brand_work_records_payment_shape",
      sql`(${t.paymentStatus} = 'confirmed') = (${t.paymentConfirmationMethod} is not null and ${t.paymentConfirmedMonth} is not null)`,
    ),
    check(
      "brand_work_records_confirmed_needs_verified",
      sql`${t.paymentStatus} = 'unconfirmed' or ${t.verificationStatus} = 'verified'`,
    ),
    check(
      "brand_work_records_month_first",
      sql`${t.paymentConfirmedMonth} is null or extract(day from ${t.paymentConfirmedMonth}) = 1`,
    ),
    check(
      "brand_work_records_four_eyes",
      sql`${t.secondReviewerId} is null or ${t.secondReviewerId} <> ${t.firstReviewerId}`,
    ),
  ],
).enableRLS();

/** Evidence for a record. The bytes live in document storage under an opaque key; no filename, no extracted text. */
export const brandWorkDocuments = pgTable(
  "brand_work_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => brandWorkRecords.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    /** Opaque storage key (random; no creator id, no filename). */
    storageKey: text("storage_key").notNull(),
    /** The storage config that holds the bytes (vendor-neutral key). */
    storageProvider: text("storage_provider").notNull(),
    sha256: text("sha256").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    scanStatus: text("scan_status", { enum: SCAN_STATUSES }).notNull().default("pending"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("brand_work_documents_record_idx").on(t.recordId),
    index("brand_work_documents_sha_idx").on(t.sha256),
    uniqueIndex("brand_work_documents_record_sha_key").on(t.recordId, t.sha256),
    check("brand_work_documents_kind_valid", sql`${t.kind} in (${sqlInList(DOCUMENT_KINDS)})`),
    check("brand_work_documents_scan_valid", sql`${t.scanStatus} in (${sqlInList(SCAN_STATUSES)})`),
    check("brand_work_documents_sha_format", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("brand_work_documents_key_format", sql`${t.storageKey} ~ '^bw/[0-9a-f]{32}$'`),
    check("brand_work_documents_mime_valid", sql`${t.mimeType} in ('application/pdf', 'image/jpeg', 'image/png')`),
    check("brand_work_documents_size_range", sql`${t.sizeBytes} between 1 and ${sql.raw(String(MAX_DOCUMENT_BYTES))}`),
  ],
).enableRLS();

/** Append-only reviewer actions (ids, codes and short notes checked for identifiers). */
export const brandWorkReviews = pgTable(
  "brand_work_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => brandWorkRecords.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action", { enum: REVIEW_ACTIONS }).notNull(),
    reasonCode: text("reason_code").references(() => brandWorkReasons.code, { onDelete: "restrict" }),
    /** Staff-only note (agency contact role, how a document was checked). Never shown to creators. */
    note: text("note"),
    /** The record's review revision this action acted on. */
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("brand_work_reviews_record_idx").on(t.recordId, t.createdAt),
    check("brand_work_reviews_action_valid", sql`${t.action} in (${sqlInList(REVIEW_ACTIONS)})`),
    check("brand_work_reviews_note_length", sql`${t.note} is null or char_length(${t.note}) <= 280`),
  ],
).enableRLS();

/** Four-eyes reversal of a verification. Approval reverses status and points in one transaction. */
export const brandWorkReversals = pgTable(
  "brand_work_reversals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => brandWorkRecords.id, { onDelete: "cascade" }),
    reasonCode: text("reason_code")
      .notNull()
      .references(() => brandWorkReasons.code, { onDelete: "restrict" }),
    status: text("status", { enum: REVERSAL_STATUSES }).notNull().default("proposed"),
    proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    check("brand_work_reversals_status_valid", sql`${t.status} in (${sqlInList(REVERSAL_STATUSES)})`),
    check("brand_work_reversals_four_eyes", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.proposedBy}`),
    uniqueIndex("brand_work_reversals_open_key")
      .on(t.recordId)
      .where(sql`${t.status} = 'proposed'`),
  ],
).enableRLS();

/** Neutral in-app notices (no points, no urgency): e.g. a bank-data permission ending. Recomputed daily. */
export const creatorNotices = pgTable(
  "creator_notices",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["aa_consent_ending", "aa_data_life_ended"] }).notNull(),
    /** The date the notice is about (e.g. when the permission ends). */
    onDate: date("on_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind] }),
    check("creator_notices_kind_valid", sql`${t.kind} in ('aa_consent_ending', 'aa_data_life_ended')`),
  ],
).enableRLS();
