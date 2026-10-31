import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  ACCESS_DECLINE_REASONS,
  ACCESS_REQUEST_STATUSES,
  MAX_POINTS_COST,
  MAX_SEATS,
  OPPORTUNITY_KINDS,
  OPPORTUNITY_STATUSES,
} from "@/modules/access/domain";
import { CREATOR_STATUS_TIERS } from "@/modules/creator-status/status";
import { LEDGER_ENTRY_TYPES } from "@/modules/rewards/rules";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { consentReceipts } from "./consent";
import { creatorProfiles } from "./creator-profile";
import { users } from "./identity";

/**
 * Access preview (Stage 14) — creator-professional domain. Brands and
 * opportunities are samples (fictional brands) in Phase 1; requests are never
 * sent to a brand. No financial data, ever.
 */
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    /** A fictional sample brand (all brands in the Phase 1 preview). */
    isSample: boolean("is_sample").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("brands_name_key").on(sql`lower(${t.name})`),
    check("brands_name_length", sql`char_length(${t.name}) between 2 and 80`),
  ],
).enableRLS();

export const accessOpportunities = pgTable(
  "access_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    kind: text("kind", { enum: OPPORTUNITY_KINDS }).notNull(),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    details: text("details").notNull(),
    /** Lowest Creator Status that may request it. */
    minTier: text("min_tier", { enum: CREATOR_STATUS_TIERS }).notNull().default("member"),
    pointsCost: integer("points_cost").notNull(),
    seats: integer("seats").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: OPPORTUNITY_STATUSES }).notNull().default("draft"),
    isSample: boolean("is_sample").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("access_opportunities_status_idx").on(t.status, t.closesAt),
    check("access_opportunities_kind_valid", sql`${t.kind} in (${sqlInList(OPPORTUNITY_KINDS)})`),
    check("access_opportunities_status_valid", sql`${t.status} in (${sqlInList(OPPORTUNITY_STATUSES)})`),
    check("access_opportunities_min_tier_valid", sql`${t.minTier} in (${sqlInList(CREATOR_STATUS_TIERS)})`),
    check("access_opportunities_cost_range", sql`${t.pointsCost} between 0 and ${sql.raw(String(MAX_POINTS_COST))}`),
    check("access_opportunities_seats_range", sql`${t.seats} between 1 and ${sql.raw(String(MAX_SEATS))}`),
    check("access_opportunities_window", sql`${t.closesAt} > ${t.opensAt}`),
    check("access_opportunities_title_length", sql`char_length(${t.title}) between 3 and 80`),
    check("access_opportunities_summary_length", sql`char_length(${t.summary}) between 3 and 200`),
    check("access_opportunities_details_length", sql`char_length(${t.details}) between 3 and 2000`),
  ],
).enableRLS();

/**
 * A creator's request for an opportunity. Tied to the `brand_opportunities`
 * consent receipt it was made under; erased when that consent is withdrawn.
 */
export const accessRequests = pgTable(
  "access_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => accessOpportunities.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    status: text("status", { enum: ACCESS_REQUEST_STATUSES }).notNull().default("requested"),
    pointsHeld: integer("points_held").notNull(),
    tierAtRequest: text("tier_at_request", { enum: CREATOR_STATUS_TIERS }).notNull(),
    /** Optional short note from the creator to the brand team. */
    note: text("note"),
    consentReceiptId: uuid("consent_receipt_id")
      .notNull()
      .references(() => consentReceipts.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    declineReason: text("decline_reason", { enum: ACCESS_DECLINE_REASONS }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Partnerships staff marked an approved request as completed (attended / delivered). Earns points once. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live request per creator per opportunity.
    uniqueIndex("access_requests_active_key")
      .on(t.opportunityId, t.creatorId)
      .where(sql`${t.status} in ('requested', 'approved')`),
    index("access_requests_queue_idx").on(t.status, t.requestedAt),
    index("access_requests_user_idx").on(t.userId, t.requestedAt.desc()),
    check("access_requests_status_valid", sql`${t.status} in (${sqlInList(ACCESS_REQUEST_STATUSES)})`),
    check("access_requests_tier_valid", sql`${t.tierAtRequest} in (${sqlInList(CREATOR_STATUS_TIERS)})`),
    check(
      "access_requests_decline_reason_valid",
      sql`${t.declineReason} is null or ${t.declineReason} in (${sqlInList(ACCESS_DECLINE_REASONS)})`,
    ),
    check("access_requests_points_range", sql`${t.pointsHeld} between 0 and ${sql.raw(String(MAX_POINTS_COST))}`),
    check("access_requests_note_length", sql`${t.note} is null or char_length(${t.note}) <= 280`),
    check(
      "access_requests_decision_shape",
      sql`(${t.status} in ('approved', 'declined')) = (${t.decidedAt} is not null)
        and (${t.status} = 'declined') = (${t.declineReason} is not null)
        and (${t.status} = 'requested') = (${t.closedAt} is null)`,
    ),
    check("access_requests_completed_shape", sql`${t.completedAt} is null or ${t.status} = 'approved'`),
  ],
).enableRLS();

/**
 * Creator Points ledger — append-only (no updates, no deletes outside erasure
 * cascades). Balance = sum(amount). A hold is a pending request's points; if
 * the request is approved the hold stands as the spend, otherwise a release
 * returns it. Simulated membership points: not money, never rupees.
 */
export const creatorPointsLedger = pgTable(
  "creator_points_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    entryType: text("entry_type", { enum: LEDGER_ENTRY_TYPES }).notNull(),
    amount: integer("amount").notNull(),
    /** earn: the rule code (e.g. `welcome`, `tier_onyx`); reverse: the rule of the earn it undoes. */
    rule: text("rule"),
    rulesVersion: text("rules_version"),
    /** earn: idempotency key, unique per creator; reverse: `reverse:<earn key>`. */
    earnKey: text("earn_key"),
    /**
     * hold/release: the request. Deliberately not a foreign key — the request row is erased when the
     * creator withdraws the brand consent, but the hold/release pairing (an id, nothing personal) must
     * survive so the balance history stays explainable.
     */
    requestId: uuid("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("creator_points_ledger_earn_key")
      .on(t.creatorId, t.earnKey)
      .where(sql`${t.earnKey} is not null`),
    uniqueIndex("creator_points_ledger_request_entry_key")
      .on(t.requestId, t.entryType)
      .where(sql`${t.requestId} is not null`),
    index("creator_points_ledger_creator_idx").on(t.creatorId, t.occurredAt.desc()),
    check("creator_points_ledger_type_valid", sql`${t.entryType} in (${sqlInList(LEDGER_ENTRY_TYPES)})`),
    check(
      "creator_points_ledger_shape",
      sql`case ${t.entryType}
        when 'earn' then ${t.amount} > 0 and ${t.rule} is not null and ${t.rulesVersion} is not null and ${t.earnKey} is not null
        when 'hold' then ${t.amount} < 0 and ${t.rule} is null and ${t.earnKey} is null
        when 'release' then ${t.amount} > 0 and ${t.rule} is null and ${t.earnKey} is null
        when 'reverse' then ${t.amount} < 0 and ${t.rule} is not null and ${t.earnKey} like 'reverse:%'
      end`,
    ),
  ],
).enableRLS();
