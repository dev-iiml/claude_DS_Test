import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { CriterionResult } from "@/modules/creator-status/rules";
import { CREATOR_STATUS_TIERS } from "@/modules/creator-status/status";

import { createdAt, sqlInList } from "./_shared";
import { creatorProfiles } from "./creator-profile";
import { professionalGraphRuns } from "./professional-graph";

/**
 * Creator Status evaluations (Stage 14). Creator-professional domain: derived
 * only from a Professional Graph run, so it is erased with that run (cascade)
 * when the creator withdraws the consents behind the signals. Append-only.
 * Never read by underwriting, fraud or lending.
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
    /** Per-criterion results (state, threshold, value) — small and non-sensitive. */
    criteria: jsonb("criteria").$type<CriterionResult[]>().notNull(),
    inputsHash: text("inputs_hash").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("creator_status_runs_creator_idx").on(t.creatorId, t.computedAt.desc(), t.createdAt.desc()),
    index("creator_status_runs_graph_run_idx").on(t.graphRunId),
    check("creator_status_runs_tier_valid", sql`${t.tier} in (${sqlInList(CREATOR_STATUS_TIERS)})`),
    check("creator_status_runs_inputs_hash_format", sql`${t.inputsHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "creator_status_runs_criteria_bounded",
      sql`jsonb_typeof(${t.criteria}) = 'array' and pg_column_size(${t.criteria}) <= 4096`,
    ),
  ],
).enableRLS();
