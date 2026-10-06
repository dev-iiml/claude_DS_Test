import { sql } from "drizzle-orm";
import { boolean, check, index, pgSchema, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { SESSION_CLIENTS, USER_ROLES, USER_STATUSES } from "@/modules/identity/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";

/**
 * `iam` schema — credential store for self-managed authentication.
 *
 * Kept in its own schema so credentials are physically separated from the
 * creator-professional domain and can be granted/locked down independently.
 * Nothing outside `src/modules/identity/auth` reads these tables.
 */
export const iam = pgSchema("iam");

export const authIdentities = iam
  .table(
    "identities",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      email: text("email").notNull(),
      /** scrypt hash string including parameters and salt. Never logged. */
      passwordHash: text("password_hash").notNull(),
      passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }).notNull().defaultNow(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("identities_email_key").on(t.email),
      check("identities_email_normalised", sql`${t.email} = lower(btrim(${t.email}))`),
    ],
  )
  .enableRLS();

export const authSessions = iam
  .table(
    "sessions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      identityId: uuid("identity_id")
        .notNull()
        .references(() => authIdentities.id, { onDelete: "cascade" }),
      /** SHA-256 (hex) of the opaque session token. The raw token only lives in the cookie / app keychain. */
      tokenHash: text("token_hash").notNull(),
      /** Which client created the session (web cookie, or bearer token from a native app / API client). */
      client: text("client", { enum: SESSION_CLIENTS }).notNull().default("web"),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
      index("sessions_identity_id_idx").on(t.identityId),
      check("sessions_token_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
      check("sessions_client_valid", sql`${t.client} in (${sqlInList(SESSION_CLIENTS)})`),
      check("sessions_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
    ],
  )
  .enableRLS();

/**
 * Login attempts for brute-force throttling. Stores a hash of the normalised
 * email (not the email itself) so attempts against unknown accounts do not
 * accumulate plaintext addresses.
 */
export const authLoginAttempts = iam
  .table(
    "login_attempts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      emailHash: text("email_hash").notNull(),
      succeeded: boolean("succeeded").notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index("login_attempts_email_hash_created_at_idx").on(t.emailHash, t.createdAt.desc()),
      check("login_attempts_email_hash_format", sql`${t.emailHash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

/** Application user. One row per authenticated principal (creator or staff). */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: uuid("auth_user_id")
      .notNull()
      .references(() => authIdentities.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    /** E.164 mobile. Only trusted once `mobile_verified_at` is set (OTP-verified). */
    mobile: text("mobile"),
    mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
    role: text("role", { enum: USER_ROLES }).notNull().default("creator"),
    status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_auth_user_id_key").on(t.authUserId),
    uniqueIndex("users_email_key").on(t.email),
    index("users_role_idx").on(t.role),
    check("users_role_valid", sql`${t.role} in (${sqlInList(USER_ROLES)})`),
    check("users_status_valid", sql`${t.status} in (${sqlInList(USER_STATUSES)})`),
    check("users_email_normalised", sql`${t.email} = lower(btrim(${t.email}))`),
    // A verified mobile number can belong to only one account (duplicate-identity guard).
    uniqueIndex("users_verified_mobile_key")
      .on(t.mobile)
      .where(sql`${t.mobileVerifiedAt} is not null`),
    check("users_mobile_verified_requires_mobile", sql`${t.mobileVerifiedAt} is null or ${t.mobile} is not null`),
    check("users_mobile_e164", sql`${t.mobile} is null or ${t.mobile} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
).enableRLS();
