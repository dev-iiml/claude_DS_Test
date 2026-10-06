import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { PROVIDER_REQUEST_OUTCOMES } from "@/modules/identity/verification-domain";

import { createdAt, sqlInList } from "./_shared";
import { consentReceipts } from "./consent";
import { users } from "./identity";

/**
 * OTP challenges for proving ownership of a mobile number. Only a hash of the
 * code is stored; challenges expire and lock after too many attempts.
 */
export const mobileVerifications = pgTable(
  "mobile_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mobile: text("mobile").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("mobile_verifications_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("mobile_verifications_mobile_e164", sql`${t.mobile} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("mobile_verifications_code_hash_format", sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    check("mobile_verifications_attempts_range", sql`${t.attempts} between 0 and 10`),
  ],
).enableRLS();

/**
 * Result of the consented "mobile number → identity" lookup used to prefill
 * the legal name. Restricted fields. The full PAN is NEVER stored — only a
 * masked form (XXXXX1234X) — and is never logged or sent to analytics.
 */
export const identityLookupResults = pgTable(
  "identity_lookup_results",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    mobile: text("mobile").notNull(),
    verifiedName: text("verified_name").notNull(),
    panMasked: text("pan_masked").notNull(),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference"),
    consentReceiptId: uuid("consent_receipt_id")
      .notNull()
      .references(() => consentReceipts.id, { onDelete: "restrict" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("identity_lookup_results_pan_masked_format", sql`${t.panMasked} ~ '^X{5}[0-9]{4}[A-Z]$'`),
    check("identity_lookup_results_name_length", sql`char_length(${t.verifiedName}) between 1 and 160`),
  ],
).enableRLS();

/**
 * One row per call to an external provider — the audit trail for
 * buy/integrate dependencies (CLAUDE.md §23). Metadata only: no payloads,
 * no PAN/GSTIN/mobile values.
 */
export const providerRequests = pgTable(
  "provider_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    providerKind: text("provider_kind").notNull(),
    providerKey: text("provider_key").notNull(),
    operation: text("operation").notNull(),
    outcome: text("outcome", { enum: PROVIDER_REQUEST_OUTCOMES }).notNull(),
    providerReference: text("provider_reference"),
    consentReceiptId: uuid("consent_receipt_id").references(() => consentReceipts.id, { onDelete: "set null" }),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("provider_requests_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("provider_requests_kind_op_created_idx").on(t.providerKind, t.operation, t.createdAt.desc()),
    check("provider_requests_outcome_valid", sql`${t.outcome} in (${sqlInList(PROVIDER_REQUEST_OUTCOMES)})`),
    check("provider_requests_operation_format", sql`${t.operation} ~ '^[a-z][a-z_]{1,63}$'`),
  ],
).enableRLS();
