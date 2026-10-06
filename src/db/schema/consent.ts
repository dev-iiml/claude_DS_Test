import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  CONSENT_SOURCES,
  CONSENT_STATUSES,
  ERASURE_SCOPES,
  ERASURE_STATUSES,
  WITHDRAWAL_REASONS,
} from "@/modules/consent/domain";

import { createdAt, sqlInList } from "./_shared";
import { users } from "./identity";

/**
 * Versioned consent text. Rows are immutable once published (trigger), except
 * for closing `active_to` when a new version supersedes them.
 */
export const consentDefinitions = pgTable(
  "consent_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    purpose: text("purpose").notNull(),
    /** The exact text shown to the creator at the time of consent. */
    body: text("body").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull(),
    activeTo: timestamp("active_to", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("consent_definitions_key_version_key").on(t.key, t.version),
    // At most one open-ended (current) version per purpose.
    uniqueIndex("consent_definitions_one_open_version_key")
      .on(t.key)
      .where(sql`${t.activeTo} is null`),
    check("consent_definitions_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{2,63}$'`),
    check("consent_definitions_version_positive", sql`${t.version} > 0`),
    check("consent_definitions_window_valid", sql`${t.activeTo} is null or ${t.activeTo} > ${t.activeFrom}`),
  ],
).enableRLS();

/**
 * One receipt per (user, definition version) grant. Receipts are append-only
 * apart from the granted → withdrawn transition (enforced by trigger).
 */
export const consentReceipts = pgTable(
  "consent_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    consentDefinitionId: uuid("consent_definition_id")
      .notNull()
      .references(() => consentDefinitions.id, { onDelete: "restrict" }),
    status: text("status", { enum: CONSENT_STATUSES }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    source: text("source", { enum: CONSENT_SOURCES }).notNull(),
    /** Non-sensitive context only (surface, locale). Size-capped by CHECK. */
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("consent_receipts_user_id_idx").on(t.userId),
    uniqueIndex("consent_receipts_one_active_grant_key")
      .on(t.userId, t.consentDefinitionId)
      .where(sql`${t.status} = 'granted'`),
    check("consent_receipts_status_valid", sql`${t.status} in (${sqlInList(CONSENT_STATUSES)})`),
    check("consent_receipts_source_valid", sql`${t.source} in (${sqlInList(CONSENT_SOURCES)})`),
    check(
      "consent_receipts_status_timestamps",
      sql`(${t.status} = 'granted' and ${t.grantedAt} is not null and ${t.withdrawnAt} is null)
        or (${t.status} = 'withdrawn' and ${t.withdrawnAt} is not null)`,
    ),
    check(
      "consent_receipts_metadata_bounded",
      sql`jsonb_typeof(${t.metadata}) = 'object' and pg_column_size(${t.metadata}) <= 1024`,
    ),
  ],
).enableRLS();

/**
 * One row per withdrawal of a receipt (append-only). Records what the
 * withdrawal changed, as small counts only — never the erased data.
 */
export const consentWithdrawals = pgTable(
  "consent_withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => consentReceipts.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    consentKey: text("consent_key").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    source: text("source", { enum: CONSENT_SOURCES }).notNull(),
    reason: text("reason", { enum: WITHDRAWAL_REASONS }),
    /** e.g. { accounts_disconnected: 2, membership_paused: true }. Size-capped, scalars only. */
    effects: jsonb("effects").$type<Record<string, string | number | boolean>>().notNull().default({}),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("consent_withdrawals_receipt_key").on(t.receiptId),
    index("consent_withdrawals_user_idx").on(t.userId, t.withdrawnAt.desc()),
    check("consent_withdrawals_source_valid", sql`${t.source} in (${sqlInList(CONSENT_SOURCES)})`),
    check(
      "consent_withdrawals_reason_valid",
      sql`${t.reason} is null or ${t.reason} in (${sqlInList(WITHDRAWAL_REASONS)})`,
    ),
    check(
      "consent_withdrawals_effects_bounded",
      sql`jsonb_typeof(${t.effects}) = 'object' and pg_column_size(${t.effects}) <= 1024`,
    ),
  ],
).enableRLS();

/**
 * Erasure triggered by a withdrawal. Deferred while a retention hold applies
 * (e.g. data that supports an open credit relationship with a regulated
 * partner); the only permitted change is deferred → completed.
 */
export const dataErasureRequests = pgTable(
  "data_erasure_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    withdrawalId: uuid("withdrawal_id")
      .notNull()
      .references(() => consentWithdrawals.id, { onDelete: "restrict" }),
    scope: text("scope", { enum: ERASURE_SCOPES }).notNull(),
    status: text("status", { enum: ERASURE_STATUSES }).notNull(),
    /** Why erasure is deferred (reason codes, never details of the credit relationship). */
    holdReasons: text("hold_reasons")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Rows erased per table, e.g. { snapshots: 24 }. */
    erased: jsonb("erased").$type<Record<string, number>>().notNull().default({}),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("data_erasure_requests_user_idx").on(t.userId),
    index("data_erasure_requests_deferred_idx")
      .on(t.status)
      .where(sql`${t.status} = 'deferred'`),
    uniqueIndex("data_erasure_requests_withdrawal_scope_key").on(t.withdrawalId, t.scope),
    check("data_erasure_requests_scope_valid", sql`${t.scope} in (${sqlInList(ERASURE_SCOPES)})`),
    check("data_erasure_requests_status_valid", sql`${t.status} in (${sqlInList(ERASURE_STATUSES)})`),
    check(
      "data_erasure_requests_status_consistent",
      sql`(${t.status} = 'completed' and ${t.completedAt} is not null)
        or (${t.status} = 'deferred' and ${t.completedAt} is null and cardinality(${t.holdReasons}) > 0)`,
    ),
    check(
      "data_erasure_requests_erased_bounded",
      sql`jsonb_typeof(${t.erased}) = 'object' and pg_column_size(${t.erased}) <= 512`,
    ),
  ],
).enableRLS();
