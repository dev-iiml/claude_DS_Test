import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  ACCESS_REQUEST_STATUSES,
  CANCEL_REASONS,
  DECLINE_REASONS,
  NOTE_MAX_LENGTH,
  OPPORTUNITY_KINDS,
  OPPORTUNITY_STATUSES,
} from "@/modules/access/domain";
import { CREATOR_STATUS_TIERS } from "@/modules/creator-status/status";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { consentReceipts } from "./consent";
import { creatorProfiles } from "./creator-profile";
import { users } from "./identity";

/**
 * Access opportunities (Stage 14). The preview carries sample opportunities
 * from fictional brands only (`is_preview` must be true): real brands need a
 * brand agreement and a new version of the Brand opportunities consent first.
 */
export const accessOpportunities = pgTable(
  "access_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    brandName: text("brand_name").notNull(),
    title: text("title").notNull(),
    kind: text("kind", { enum: OPPORTUNITY_KINDS }).notNull(),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    minTier: text("min_tier", { enum: CREATOR_STATUS_TIERS }).notNull(),
    pointsCost: integer("points_cost").notNull(),
    places: integer("places").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: OPPORTUNITY_STATUSES }).notNull().default("open"),
    isPreview: boolean("is_preview").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("access_opportunities_slug_key").on(t.slug),
    index("access_opportunities_listing_idx").on(t.status, t.closesAt),
    check("access_opportunities_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{2,63}$'`),
    check("access_opportunities_kind_valid", sql`${t.kind} in (${sqlInList(OPPORTUNITY_KINDS)})`),
    check("access_opportunities_status_valid", sql`${t.status} in (${sqlInList(OPPORTUNITY_STATUSES)})`),
    check("access_opportunities_min_tier_valid", sql`${t.minTier} in (${sqlInList(CREATOR_STATUS_TIERS)})`),
    check("access_opportunities_points_cost_range", sql`${t.pointsCost} between 0 and 100000`),
    check("access_opportunities_places_range", sql`${t.places} between 1 and 1000`),
    check("access_opportunities_window_valid", sql`${t.closesAt} > ${t.opensAt}`),
    check("access_opportunities_preview_only", sql`${t.isPreview}`),
    check(
      "access_opportunities_text_bounded",
      sql`char_length(${t.brandName}) between 2 and 60 and char_length(${t.title}) between 3 and 80
          and char_length(${t.category}) between 2 and 40 and char_length(${t.summary}) between 10 and 600`,
    ),
  ],
).enableRLS();

/**
 * A creator's request for an opportunity. Points are held while it is
 * `requested`; it then moves exactly once (guard trigger, migration 0032):
 * approved (points spent) or declined / cancelled / expired (points returned).
 * Rows are deleted only by erasure (Brand opportunities consent withdrawn).
 */
export const accessRequests = pgTable(
  "access_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => accessOpportunities.id, { onDelete: "restrict" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ACCESS_REQUEST_STATUSES }).notNull().default("requested"),
    /** Optional note from the creator to the partnerships team. */
    note: text("note"),
    pointsHeld: integer("points_held").notNull(),
    consentReceiptId: uuid("consent_receipt_id")
      .notNull()
      .references(() => consentReceipts.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    declineReason: text("decline_reason", { enum: DECLINE_REASONS }),
    cancelReason: text("cancel_reason", { enum: CANCEL_REASONS }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live request per creator and opportunity.
    uniqueIndex("access_requests_active_key")
      .on(t.creatorId, t.opportunityId)
      .where(sql`${t.status} in ('requested', 'approved')`),
    index("access_requests_queue_idx").on(t.status, t.requestedAt),
    index("access_requests_opportunity_idx").on(t.opportunityId, t.status),
    index("access_requests_creator_idx").on(t.creatorId, t.requestedAt.desc()),
    index("access_requests_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'requested'`),
    check("access_requests_status_valid", sql`${t.status} in (${sqlInList(ACCESS_REQUEST_STATUSES)})`),
    check("access_requests_points_held_range", sql`${t.pointsHeld} >= 0`),
    check(
      "access_requests_note_bounded",
      sql`${t.note} is null or char_length(${t.note}) between 1 and ${sql.raw(String(NOTE_MAX_LENGTH))}`,
    ),
    check("access_requests_expiry_after_request", sql`${t.expiresAt} > ${t.requestedAt}`),
    check(
      "access_requests_decline_reason_valid",
      sql`${t.declineReason} is null or ${t.declineReason} in (${sqlInList(DECLINE_REASONS)})`,
    ),
    check(
      "access_requests_cancel_reason_valid",
      sql`${t.cancelReason} is null or ${t.cancelReason} in (${sqlInList(CANCEL_REASONS)})`,
    ),
    check(
      "access_requests_outcome_shape",
      sql`(${t.status} = 'requested') = (${t.decidedAt} is null)
          and (${t.status} in ('approved', 'declined')) = (${t.decidedBy} is not null)
          and (${t.status} = 'declined') = (${t.declineReason} is not null)
          and (${t.status} = 'cancelled') = (${t.cancelReason} is not null)`,
    ),
  ],
).enableRLS();
