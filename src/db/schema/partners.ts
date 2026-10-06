import { sql } from "drizzle-orm";
import { bigserial, check, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  API_KEY_STATUSES,
  DELIVERY_STATUSES,
  ENDPOINT_STATUSES,
  PARTNER_ENVIRONMENTS,
  PARTNER_EVENT_TYPES,
  PARTNER_SCOPES,
  PARTNER_STATUSES,
} from "@/modules/partners/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { creditProposals, decisionQueries } from "./financial";
import { users } from "./identity";
import { ops } from "./ops";

/**
 * Partner access (Stage 12b) — control plane, `ops` schema. Partners,
 * hashed API keys, webhook endpoints, a thin event outbox and delivery
 * attempts. Identifiers only: no creator or financial data, and no secrets
 * (API keys are SHA-256 hashes; webhook signing secrets are derived).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const partners = ops
  .table(
    "partners",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** Vendor-neutral key, e.g. `partner_sandbox`. */
      key: text("key").notNull(),
      name: text("name").notNull(),
      environment: text("environment", { enum: PARTNER_ENVIRONMENTS }).notNull(),
      /** The lender provider config (`ops.provider_configs.key`, kind lender) whose proposals this partner receives. */
      lenderKey: text("lender_key").notNull(),
      status: text("status", { enum: PARTNER_STATUSES }).notNull().default("active"),
      createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("partners_key_uq").on(t.key),
      uniqueIndex("partners_lender_key_uq").on(t.lenderKey),
      check("partners_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{1,39}$'`),
      check("partners_lender_key_format", sql`${t.lenderKey} ~ '^[a-z][a-z0-9_]{0,39}$'`),
      check("partners_name_length", sql`char_length(${t.name}) between 2 and 80`),
      check("partners_environment_valid", sql`${t.environment} in (${sqlInList(PARTNER_ENVIRONMENTS)})`),
      check("partners_status_valid", sql`${t.status} in (${sqlInList(PARTNER_STATUSES)})`),
    ],
  )
  .enableRLS();

/** API keys: proposed by one ops admin, approved by another (four eyes, CHECK). Only the hash is stored. */
export const partnerApiKeys = ops
  .table(
    "partner_api_keys",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      partnerId: uuid("partner_id")
        .notNull()
        .references(() => partners.id, { onDelete: "restrict" }),
      /** Public part, e.g. `cck_test_ab12cd34` (shown in /ops, recorded with decisions). */
      prefix: text("prefix").notNull(),
      secretHash: text("secret_hash").notNull(),
      label: text("label").notNull(),
      scopes: text("scopes", { enum: PARTNER_SCOPES }).array().notNull(),
      status: text("status", { enum: API_KEY_STATUSES }).notNull().default("pending"),
      expiresAt: ts("expires_at").notNull(),
      /** Rotation: the key this one replaces; it keeps working for `overlapHours` after approval. */
      replacesKeyId: uuid("replaces_key_id"),
      overlapHours: integer("overlap_hours"),
      proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "restrict" }),
      proposedAt: ts("proposed_at").notNull(),
      decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
      decidedAt: ts("decided_at"),
      revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "restrict" }),
      revokedAt: ts("revoked_at"),
      revokeReason: text("revoke_reason"),
      lastUsedAt: ts("last_used_at"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("partner_api_keys_prefix_uq").on(t.prefix),
      index("partner_api_keys_partner_idx").on(t.partnerId, t.createdAt.desc()),
      check("partner_api_keys_prefix_format", sql`${t.prefix} ~ '^cck_(test|live)_[a-z0-9]{8}$'`),
      check("partner_api_keys_hash_format", sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
      check("partner_api_keys_label_length", sql`char_length(${t.label}) between 2 and 80`),
      check("partner_api_keys_status_valid", sql`${t.status} in (${sqlInList(API_KEY_STATUSES)})`),
      check(
        "partner_api_keys_scopes_valid",
        sql`cardinality(${t.scopes}) between 1 and 3 and ${t.scopes} <@ array[${sqlInList(PARTNER_SCOPES)}]::text[]`,
      ),
      check(
        "partner_api_keys_four_eyes",
        sql`${t.decidedBy} is null or ${t.proposedBy} is null or ${t.decidedBy} <> ${t.proposedBy}`,
      ),
      check(
        "partner_api_keys_approved",
        sql`${t.status} in ('pending', 'expired', 'cancelled') or ${t.proposedBy} is null or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
      ),
      check(
        "partner_api_keys_revoked",
        sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null and ${t.revokedBy} is not null)`,
      ),
      check(
        "partner_api_keys_revoke_reason",
        sql`${t.revokeReason} is null or char_length(${t.revokeReason}) between 3 and 500`,
      ),
      check("partner_api_keys_overlap", sql`${t.overlapHours} is null or ${t.overlapHours} between 0 and 720`),
    ],
  )
  .enableRLS();

/** Webhook endpoints: a new URL needs a second ops admin. One active (and one pending) per partner. */
export const partnerWebhookEndpoints = ops
  .table(
    "partner_webhook_endpoints",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      partnerId: uuid("partner_id")
        .notNull()
        .references(() => partners.id, { onDelete: "restrict" }),
      url: text("url").notNull(),
      status: text("status", { enum: ENDPOINT_STATUSES }).notNull().default("pending"),
      /** Signing secret version (the secret itself is derived, never stored). */
      secretVersion: integer("secret_version").notNull().default(1),
      previousSecretVersion: integer("previous_secret_version"),
      previousSecretUntil: ts("previous_secret_until"),
      proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "restrict" }),
      proposedAt: ts("proposed_at").notNull(),
      decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
      decidedAt: ts("decided_at"),
      retiredAt: ts("retired_at"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("partner_webhook_endpoints_one_active")
        .on(t.partnerId)
        .where(sql`${t.status} = 'active'`),
      uniqueIndex("partner_webhook_endpoints_one_pending")
        .on(t.partnerId)
        .where(sql`${t.status} = 'pending'`),
      check("partner_webhook_endpoints_status_valid", sql`${t.status} in (${sqlInList(ENDPOINT_STATUSES)})`),
      check("partner_webhook_endpoints_url_length", sql`char_length(${t.url}) between 10 and 500`),
      check("partner_webhook_endpoints_url_scheme", sql`${t.url} ~ '^https?://'`),
      check(
        "partner_webhook_endpoints_four_eyes",
        sql`${t.decidedBy} is null or ${t.proposedBy} is null or ${t.decidedBy} <> ${t.proposedBy}`,
      ),
      check(
        "partner_webhook_endpoints_approved",
        sql`${t.status} in ('pending', 'expired', 'cancelled') or ${t.proposedBy} is null or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
      ),
      check("partner_webhook_endpoints_secret_version", sql`${t.secretVersion} >= 1`),
      check(
        "partner_webhook_endpoints_previous_secret",
        sql`(${t.previousSecretVersion} is null) = (${t.previousSecretUntil} is null)`,
      ),
    ],
  )
  .enableRLS();

/**
 * Thin events for a partner (outbox + the partner's recovery feed). Ids only;
 * append-only. Erased with the proposal (cascade).
 */
export const partnerEvents = ops
  .table(
    "partner_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** Feed cursor (monotonic). */
      seq: bigserial("seq", { mode: "number" }).notNull(),
      partnerId: uuid("partner_id")
        .notNull()
        .references(() => partners.id, { onDelete: "restrict" }),
      type: text("type", { enum: PARTNER_EVENT_TYPES }).notNull(),
      proposalId: uuid("proposal_id").references(() => creditProposals.id, { onDelete: "cascade" }),
      queryId: uuid("query_id").references(() => decisionQueries.id, { onDelete: "cascade" }),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("partner_events_seq_uq").on(t.seq),
      index("partner_events_partner_seq_idx").on(t.partnerId, t.seq),
      check("partner_events_type_valid", sql`${t.type} in (${sqlInList(PARTNER_EVENT_TYPES)})`),
      check("partner_events_proposal_needed", sql`${t.type} = 'ping' or ${t.proposalId} is not null`),
      check(
        "partner_events_query_needed",
        sql`${t.type} not in ('decision.queried', 'decision.query_withdrawn') or ${t.queryId} is not null`,
      ),
    ],
  )
  .enableRLS();

/** One delivery per event and endpoint: attempts, backoff, last HTTP status. Never a request or response body. */
export const partnerWebhookDeliveries = ops
  .table(
    "partner_webhook_deliveries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      eventId: uuid("event_id")
        .notNull()
        .references(() => partnerEvents.id, { onDelete: "cascade" }),
      endpointId: uuid("endpoint_id")
        .notNull()
        .references(() => partnerWebhookEndpoints.id, { onDelete: "restrict" }),
      status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
      attempts: integer("attempts").notNull().default(0),
      nextAttemptAt: ts("next_attempt_at"),
      lastAttemptAt: ts("last_attempt_at"),
      lastHttpStatus: integer("last_http_status"),
      /** Error class only (`timeout`, `network`, `http_500` …). */
      lastError: text("last_error"),
      deliveredAt: ts("delivered_at"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("partner_webhook_deliveries_event_endpoint_uq").on(t.eventId, t.endpointId),
      index("partner_webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
      check("partner_webhook_deliveries_status_valid", sql`${t.status} in (${sqlInList(DELIVERY_STATUSES)})`),
      check("partner_webhook_deliveries_attempts", sql`${t.attempts} between 0 and 50`),
      check(
        "partner_webhook_deliveries_error_length",
        sql`${t.lastError} is null or char_length(${t.lastError}) <= 40`,
      ),
      check("partner_webhook_deliveries_delivered", sql`(${t.status} = 'delivered') = (${t.deliveredAt} is not null)`),
    ],
  )
  .enableRLS();
