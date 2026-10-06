import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { FEATURE_CONFIDENCE, FEATURE_SOURCES, GRAPH_RUN_TRIGGERS } from "@/modules/professional-graph/domain";

import { createdAt, sqlInList } from "./_shared";
import { creatorProfiles } from "./creator-profile";

/**
 * One Professional Graph computation. (creator, engine_version, inputs_hash)
 * is unique, so identical inputs never produce a second, different result —
 * every run is reproducible from its inputs and engine version.
 */
export const professionalGraphRuns = pgTable(
  "professional_graph_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    engineVersion: text("engine_version").notNull(),
    inputsHash: text("inputs_hash").notNull(),
    snapshotCount: integer("snapshot_count").notNull(),
    trigger: text("trigger", { enum: GRAPH_RUN_TRIGGERS }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("professional_graph_runs_reproducible_key").on(t.creatorId, t.engineVersion, t.inputsHash),
    index("professional_graph_runs_creator_idx").on(t.creatorId, t.computedAt.desc()),
    check("professional_graph_runs_inputs_hash_format", sql`${t.inputsHash} ~ '^[0-9a-f]{64}$'`),
    check("professional_graph_runs_trigger_valid", sql`${t.trigger} in (${sqlInList(GRAPH_RUN_TRIGGERS)})`),
  ],
).enableRLS();

/**
 * Derived creator-professional features with provenance. Creator-professional
 * domain only — never financial data — and never a credit score.
 */
export const creatorProfessionalFeatures = pgTable(
  "creator_professional_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => professionalGraphRuns.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    featureVersion: text("feature_version").notNull(),
    valueNumeric: numeric("value_numeric", { precision: 18, scale: 6 }),
    valueBoolean: boolean("value_boolean"),
    unit: text("unit").notNull(),
    source: text("source", { enum: FEATURE_SOURCES }).notNull(),
    /** 0–1: share of the required input window actually available. */
    completeness: numeric("completeness", { precision: 4, scale: 3 }).notNull(),
    confidence: text("confidence", { enum: FEATURE_CONFIDENCE }).notNull(),
    /** Small, non-sensitive description of inputs (platforms, months, snapshot count). */
    provenance: jsonb("provenance").$type<Record<string, string | number | boolean | string[]>>().notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("creator_professional_features_run_key").on(t.runId, t.featureKey),
    index("creator_professional_features_creator_idx").on(t.creatorId, t.featureKey, t.computedAt.desc()),
    check("creator_professional_features_key_format", sql`${t.featureKey} ~ '^[a-z][a-z0-9_]{2,63}$'`),
    check("creator_professional_features_source_valid", sql`${t.source} in (${sqlInList(FEATURE_SOURCES)})`),
    check("creator_professional_features_confidence_valid", sql`${t.confidence} in (${sqlInList(FEATURE_CONFIDENCE)})`),
    check("creator_professional_features_completeness_range", sql`${t.completeness} between 0 and 1`),
    check(
      "creator_professional_features_has_value",
      sql`${t.valueNumeric} is not null or ${t.valueBoolean} is not null or ${t.completeness} = 0`,
    ),
    check(
      "creator_professional_features_provenance_bounded",
      sql`jsonb_typeof(${t.provenance}) = 'object' and pg_column_size(${t.provenance}) <= 2048`,
    ),
  ],
).enableRLS();
