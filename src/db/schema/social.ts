import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { CONNECTION_STATUSES, SNAPSHOT_SOURCES } from "@/modules/social-data/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { creatorProfiles } from "./creator-profile";

/** Supported platforms. Reference table so new platforms need no migration of check constraints. */
export const socialPlatforms = pgTable(
  "social_platforms",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check("social_platforms_code_format", sql`${t.code} ~ '^[a-z][a-z0-9_]{0,39}$'`)],
).enableRLS();

export const creatorSocialAccounts = pgTable(
  "creator_social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    platform: text("platform")
      .notNull()
      .references(() => socialPlatforms.code),
    /** The account's id at the platform/provider. Vendor-neutral name by design. */
    externalAccountId: text("external_account_id"),
    handle: text("handle").notNull(),
    /** The handle the creator self-declared for this platform (kept after a connection upgrades the row). */
    declaredHandle: text("declared_handle"),
    connectionStatus: text("connection_status", { enum: CONNECTION_STATUSES }).notNull(),
    /** Provider key (e.g. `self_declared`, `mock`). Resolved via the provider registry. */
    provider: text("provider").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    /** When the account was created at the platform, as reported by the provider (verified longevity). */
    accountCreatedAt: timestamp("account_created_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    /** The creator's main account on this platform (exactly one among active accounts). */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("creator_social_accounts_creator_id_idx").on(t.creatorId),
    uniqueIndex("creator_social_accounts_active_handle_key")
      .on(t.creatorId, t.platform, sql`lower(${t.handle})`)
      .where(sql`${t.connectionStatus} <> 'disconnected'`),
    uniqueIndex("creator_social_accounts_primary_key")
      .on(t.creatorId, t.platform)
      .where(sql`${t.isPrimary} and ${t.connectionStatus} <> 'disconnected'`),
    // The same external account must not be linked to two creators at once.
    uniqueIndex("creator_social_accounts_external_account_key")
      .on(t.provider, t.platform, t.externalAccountId)
      .where(sql`${t.externalAccountId} is not null and ${t.connectionStatus} <> 'disconnected'`),
    check("creator_social_accounts_status_valid", sql`${t.connectionStatus} in (${sqlInList(CONNECTION_STATUSES)})`),
    check("creator_social_accounts_handle_format", sql`${t.handle} ~ '^[A-Za-z0-9._-]{2,64}$'`),
    check("creator_social_accounts_provider_format", sql`${t.provider} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      "creator_social_accounts_connected_has_timestamp",
      sql`${t.connectionStatus} <> 'connected' or ${t.connectedAt} is not null`,
    ),
    check(
      "creator_social_accounts_disconnected_has_timestamp",
      sql`${t.connectionStatus} <> 'disconnected' or ${t.disconnectedAt} is not null`,
    ),
  ],
).enableRLS();

/**
 * Point-in-time metrics for a social account — the raw material of the
 * Creator Professional Graph. Raw provider payloads are never stored inline;
 * `raw_payload_ref` points at restricted storage when retention is approved.
 */
export const creatorSocialSnapshots = pgTable(
  "creator_social_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => creatorSocialAccounts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    followers: bigint("followers", { mode: "number" }),
    subscribers: bigint("subscribers", { mode: "number" }),
    views: bigint("views", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    /** Ratio, not percent (0.0345 = 3.45%). */
    engagementRate: numeric("engagement_rate", { precision: 9, scale: 6 }),
    postsCount: integer("posts_count"),
    rawPayloadRef: text("raw_payload_ref"),
    source: text("source", { enum: SNAPSHOT_SOURCES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("creator_social_snapshots_account_captured_idx").on(t.socialAccountId, t.capturedAt.desc()),
    // Idempotent ingestion: one snapshot per account, instant and source.
    uniqueIndex("creator_social_snapshots_idempotency_key").on(t.socialAccountId, t.capturedAt, t.source),
    check("creator_social_snapshots_source_valid", sql`${t.source} in (${sqlInList(SNAPSHOT_SOURCES)})`),
    check(
      "creator_social_snapshots_non_negative",
      sql`coalesce(${t.followers}, 0) >= 0 and coalesce(${t.subscribers}, 0) >= 0
        and coalesce(${t.views}, 0) >= 0 and coalesce(${t.reach}, 0) >= 0
        and coalesce(${t.postsCount}, 0) >= 0 and coalesce(${t.engagementRate}, 0) >= 0`,
    ),
    check(
      "creator_social_snapshots_payload_ref_is_reference",
      sql`${t.rawPayloadRef} is null or (char_length(${t.rawPayloadRef}) <= 512 and ${t.rawPayloadRef} !~ '[{}]')`,
    ),
  ],
).enableRLS();

/**
 * Pending OAuth-style connection attempts. Only a SHA-256 of the `state`
 * value is stored; requests expire and can be completed once.
 */
export const socialConnectionRequests = pgTable(
  "social_connection_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    platform: text("platform")
      .notNull()
      .references(() => socialPlatforms.code),
    provider: text("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    /** Whether the creator also opted in to professional analytics for this connection. */
    analyticsOptIn: boolean("analytics_opt_in").notNull().default(false),
    /** An extra account on a platform that already has one (never upgrades the declared row). */
    additional: boolean("additional").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("social_connection_requests_state_hash_key").on(t.stateHash),
    index("social_connection_requests_creator_idx").on(t.creatorId, t.createdAt.desc()),
    check("social_connection_requests_state_hash_format", sql`${t.stateHash} ~ '^[0-9a-f]{64}$'`),
  ],
).enableRLS();
