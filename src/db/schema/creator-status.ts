import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { TierChecklist } from "@/modules/creator-status/rules";
import { CREATOR_STATUS_TIERS } from "@/modules/creator-status/status";

import { createdAt, sqlInList } from "./_shared";
import { creatorProfiles } from "./creator-profile";
import { professionalGraphRuns } from "./professional-graph";

/**
 * One Creator Status calculation (Stage 14), tied to the Professional Graph
 * run it read. Append-only. Deleting the graph run (consent withdrawal or
 * erasure) cascades here, so Status is erased with the signals it came from
 * and the creator falls back to Member.
 *
 * Creator-professional domain only. Status is never creditworthiness and no
 * credit module may read this table.
 */
export const creatorStatusRuns = pgTable(
  "creator_status_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    graphRunId: uuid("graph_run_id")
      .notNull()
      .references(() => professionalGraphRuns.id, { onDelete: "cascade" }),
    rulesVersion: text("rules_version").notNull(),
    tier: text("tier", { enum: CREATOR_STATUS_TIERS }).notNull(),
    /** Per-tier checklist: criterion, met, the signal value used and its threshold. Numbers and booleans only. */
    criteria: jsonb("criteria").$type<TierChecklist[]>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // The same graph run under the same rules always gives the same status — calculate it once.
    uniqueIndex("creator_status_runs_reproducible_key").on(t.graphRunId, t.rulesVersion),
    index("creator_status_runs_creator_idx").on(t.creatorId, t.computedAt.desc()),
    check("creator_status_runs_tier_valid", sql`${t.tier} in (${sqlInList(CREATOR_STATUS_TIERS)})`),
    check("creator_status_runs_rules_version_format", sql`${t.rulesVersion} ~ '^cs-[0-9]+\\.[0-9]+\\.[0-9]+$'`),
    check(
      "creator_status_runs_criteria_bounded",
      sql`jsonb_typeof(${t.criteria}) = 'array' and pg_column_size(${t.criteria}) <= 4096`,
    ),
  ],
).enableRLS();
