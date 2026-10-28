import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { POINTS_ENTRY_TYPES, POINTS_MILESTONES } from "@/modules/rewards/domain";

import { createdAt, sqlInList } from "./_shared";
import { creatorProfiles } from "./creator-profile";

/**
 * Creator Points ledger (Stage 14). Append-only: the balance is the sum of
 * `amount`. Points are a simulation — not cash, not rupees, not transferable.
 *
 * `access_request_id` deliberately has no foreign key: erasing a creator's
 * request history (Brand opportunities consent withdrawn) must not break the
 * pairing of a hold with its release, so the ledger keeps the id only.
 */
export const creatorPointsLedger = pgTable(
  "creator_points_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    entryType: text("entry_type", { enum: POINTS_ENTRY_TYPES }).notNull(),
    /** Signed: earn and release are positive, hold is negative. */
    amount: integer("amount").notNull(),
    milestone: text("milestone", { enum: POINTS_MILESTONES }),
    accessRequestId: uuid("access_request_id"),
    rulesVersion: text("rules_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("creator_points_ledger_creator_idx").on(t.creatorId, t.createdAt),
    // Each milestone is granted once.
    uniqueIndex("creator_points_ledger_milestone_key")
      .on(t.creatorId, t.milestone)
      .where(sql`${t.milestone} is not null`),
    // A request holds points once and releases them at most once.
    uniqueIndex("creator_points_ledger_request_entry_key")
      .on(t.accessRequestId, t.entryType)
      .where(sql`${t.accessRequestId} is not null`),
    check("creator_points_ledger_entry_type_valid", sql`${t.entryType} in (${sqlInList(POINTS_ENTRY_TYPES)})`),
    check(
      "creator_points_ledger_milestone_valid",
      sql`${t.milestone} is null or ${t.milestone} in (${sqlInList(POINTS_MILESTONES)})`,
    ),
    check(
      "creator_points_ledger_amount_sign",
      sql`(${t.entryType} = 'hold' and ${t.amount} < 0) or (${t.entryType} <> 'hold' and ${t.amount} > 0)`,
    ),
    check(
      "creator_points_ledger_shape",
      sql`(${t.entryType} = 'earn') = (${t.milestone} is not null)
          and (${t.entryType} = 'earn') = (${t.accessRequestId} is null)`,
    ),
    check("creator_points_ledger_rules_version_format", sql`${t.rulesVersion} ~ '^pts-[0-9]+\\.[0-9]+\\.[0-9]+$'`),
  ],
).enableRLS();
