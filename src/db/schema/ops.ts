import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { CHANGE_ACTIONS, CHANGE_STATUSES, CIRCUIT_STATES, HEALTH_STATUSES } from "@/modules/integrations/domain";
import { JOB_STATUSES, JOB_TYPES } from "@/modules/jobs/domain";
import { POLICY_STATUSES } from "@/modules/lending/domain";
import { PROVIDER_KINDS, PROVIDER_MODES } from "@/providers/types";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { users } from "./identity";

/**
 * `ops` schema — the integration control plane: which adapter serves each
 * capability, runtime health, change approvals and background jobs. It holds
 * no creator or financial data, and no secrets: a config references env var
 * names only.
 */
export const ops = pgSchema("ops");

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const providerConfigs = ops
  .table(
    "provider_configs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      kind: text("kind", { enum: PROVIDER_KINDS }).notNull(),
      /** Vendor-neutral key recorded with data this config produces. */
      key: text("key").notNull(),
      /** Adapter id from the code catalog (`src/providers/catalog.ts`). */
      adapter: text("adapter").notNull(),
      mode: text("mode", { enum: PROVIDER_MODES }).notNull(),
      enabled: boolean("enabled").notNull().default(false),
      /** Non-secret adapter settings, validated by the adapter's strict schema. */
      settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
      /** Logical secret name → env var name (`INTEGRATION_*`). Never a value. */
      secretRefs: jsonb("secret_refs").$type<Record<string, string>>().notNull().default({}),
      version: integer("version").notNull().default(1),
      createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("provider_configs_kind_key_uq").on(t.kind, t.key),
      unique("provider_configs_kind_id_uq").on(t.kind, t.id),
      check("provider_configs_kind_valid", sql`${t.kind} in (${sqlInList(PROVIDER_KINDS)})`),
      check("provider_configs_mode_valid", sql`${t.mode} in (${sqlInList(PROVIDER_MODES)})`),
      check("provider_configs_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
      check("provider_configs_adapter_format", sql`${t.adapter} ~ '^[a-z][a-z0-9_]{0,39}$'`),
      check("provider_configs_settings_size", sql`pg_column_size(${t.settings}) <= 2048`),
      check("provider_configs_secret_refs_size", sql`pg_column_size(${t.secretRefs}) <= 1024`),
      check("provider_configs_version_positive", sql`${t.version} >= 1`),
    ],
  )
  .enableRLS();

export const providerRoutes = ops
  .table(
    "provider_routes",
    {
      kind: text("kind", { enum: PROVIDER_KINDS }).primaryKey(),
      primaryConfigId: uuid("primary_config_id").notNull(),
      fallbackConfigId: uuid("fallback_config_id"),
      /** Kill switch: no calls for this capability while true. */
      paused: boolean("paused").notNull().default(false),
      pausedReason: text("paused_reason"),
      pausedAt: ts("paused_at"),
      pausedBy: uuid("paused_by").references(() => users.id, { onDelete: "restrict" }),
      version: integer("version").notNull().default(1),
      updatedAt: updatedAt(),
    },
    (t) => [
      // A route can only point at configs of its own capability.
      foreignKey({
        name: "provider_routes_primary_fk",
        columns: [t.kind, t.primaryConfigId],
        foreignColumns: [providerConfigs.kind, providerConfigs.id],
      }).onDelete("restrict"),
      foreignKey({
        name: "provider_routes_fallback_fk",
        columns: [t.kind, t.fallbackConfigId],
        foreignColumns: [providerConfigs.kind, providerConfigs.id],
      }).onDelete("restrict"),
      check("provider_routes_kind_valid", sql`${t.kind} in (${sqlInList(PROVIDER_KINDS)})`),
      check(
        "provider_routes_fallback_distinct",
        sql`${t.fallbackConfigId} is null or ${t.fallbackConfigId} <> ${t.primaryConfigId}`,
      ),
      check(
        "provider_routes_paused_state",
        sql`(${t.paused} and ${t.pausedAt} is not null and ${t.pausedReason} is not null) or (not ${t.paused} and ${t.pausedAt} is null and ${t.pausedReason} is null)`,
      ),
      check("provider_routes_paused_reason_length", sql`char_length(${t.pausedReason}) <= 500`),
    ],
  )
  .enableRLS();

/** Per-config runtime state shared by every app instance: circuit breaker and last health check. */
export const providerRuntime = ops
  .table(
    "provider_runtime",
    {
      configId: uuid("config_id")
        .primaryKey()
        .references(() => providerConfigs.id, { onDelete: "cascade" }),
      circuitState: text("circuit_state", { enum: CIRCUIT_STATES }).notNull().default("closed"),
      consecutiveFailures: integer("consecutive_failures").notNull().default(0),
      openedAt: ts("opened_at"),
      lastFailureAt: ts("last_failure_at"),
      healthStatus: text("health_status", { enum: HEALTH_STATUSES }).notNull().default("unknown"),
      healthCheckedAt: ts("health_checked_at"),
      healthLatencyMs: integer("health_latency_ms"),
      updatedAt: updatedAt(),
    },
    (t) => [
      check("provider_runtime_circuit_valid", sql`${t.circuitState} in (${sqlInList(CIRCUIT_STATES)})`),
      check("provider_runtime_health_valid", sql`${t.healthStatus} in (${sqlInList(HEALTH_STATUSES)})`),
      check("provider_runtime_open_state", sql`(${t.circuitState} = 'closed') = (${t.openedAt} is null)`),
      check("provider_runtime_failures_non_negative", sql`${t.consecutiveFailures} >= 0`),
    ],
  )
  .enableRLS();

/** Hourly call counts per config and operation. Outcomes and timings only. */
export const providerCallStats = ops
  .table(
    "provider_call_stats",
    {
      configId: uuid("config_id")
        .notNull()
        .references(() => providerConfigs.id, { onDelete: "cascade" }),
      bucket: ts("bucket").notNull(),
      operation: text("operation").notNull(),
      successes: integer("successes").notNull().default(0),
      failures: integer("failures").notNull().default(0),
      rejections: integer("rejections").notNull().default(0),
      totalDurationMs: bigint("total_duration_ms", { mode: "number" }).notNull().default(0),
    },
    (t) => [
      primaryKey({ columns: [t.configId, t.bucket, t.operation] }),
      index("provider_call_stats_bucket_idx").on(t.bucket),
      check("provider_call_stats_operation_format", sql`${t.operation} ~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$'`),
    ],
  )
  .enableRLS();

/**
 * Every control-plane change, including instant ones (kill switch), as a
 * request. Pending requests are decided by a different person (maker-checker,
 * also enforced by a CHECK). Decided requests are immutable (trigger).
 */
export const integrationChangeRequests = ops
  .table(
    "integration_change_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      action: text("action", { enum: CHANGE_ACTIONS }).notNull(),
      kind: text("kind", { enum: PROVIDER_KINDS }).notNull(),
      /** Target config (update), or the config created (create, once applied). */
      configId: uuid("config_id").references(() => providerConfigs.id, { onDelete: "restrict" }),
      /** Validated change; env var names only, never secret values. */
      payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
      reason: text("reason").notNull(),
      approvalRequired: boolean("approval_required").notNull(),
      status: text("status", { enum: CHANGE_STATUSES }).notNull(),
      baseRouteVersion: integer("base_route_version"),
      baseConfigVersion: integer("base_config_version"),
      requestedBy: uuid("requested_by")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      requestedAt: ts("requested_at").notNull().defaultNow(),
      expiresAt: ts("expires_at"),
      decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
      decidedAt: ts("decided_at"),
      decisionNote: text("decision_note"),
      appliedAt: ts("applied_at"),
    },
    (t) => [
      index("integration_change_requests_status_idx").on(t.status, t.requestedAt.desc()),
      index("integration_change_requests_kind_idx").on(t.kind, t.requestedAt.desc()),
      check("integration_change_requests_action_valid", sql`${t.action} in (${sqlInList(CHANGE_ACTIONS)})`),
      check("integration_change_requests_status_valid", sql`${t.status} in (${sqlInList(CHANGE_STATUSES)})`),
      check("integration_change_requests_kind_valid", sql`${t.kind} in (${sqlInList(PROVIDER_KINDS)})`),
      check("integration_change_requests_payload_size", sql`pg_column_size(${t.payload}) <= 4096`),
      check("integration_change_requests_reason_length", sql`char_length(${t.reason}) between 4 and 500`),
      check("integration_change_requests_note_length", sql`char_length(${t.decisionNote}) <= 500`),
      check(
        "integration_change_requests_four_eyes",
        sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy} or ${t.status} = 'cancelled'`,
      ),
      check(
        "integration_change_requests_pending_needs_approval",
        sql`${t.status} <> 'pending' or ${t.approvalRequired}`,
      ),
      check(
        "integration_change_requests_approved_by_someone",
        sql`${t.status} <> 'applied' or not ${t.approvalRequired} or ${t.decidedBy} is not null`,
      ),
      check("integration_change_requests_applied_state", sql`(${t.status} = 'applied') = (${t.appliedAt} is not null)`),
    ],
  )
  .enableRLS();

export const jobs = ops
  .table(
    "jobs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      type: text("type", { enum: JOB_TYPES }).notNull(),
      status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
      /** Identifiers only. */
      payload: jsonb("payload").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
      dedupeKey: text("dedupe_key"),
      attempts: integer("attempts").notNull().default(0),
      maxAttempts: integer("max_attempts").notNull().default(5),
      runAfter: ts("run_after").notNull().defaultNow(),
      lockedAt: ts("locked_at"),
      lastError: text("last_error"),
      /** Counts only, e.g. `{ expired: 3 }`. */
      result: jsonb("result").$type<Record<string, number>>(),
      requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
      createdAt: createdAt(),
      finishedAt: ts("finished_at"),
    },
    (t) => [
      uniqueIndex("jobs_dedupe_key_uq").on(t.dedupeKey),
      index("jobs_due_idx").on(t.status, t.runAfter),
      index("jobs_type_created_idx").on(t.type, t.createdAt.desc()),
      check("jobs_type_valid", sql`${t.type} in (${sqlInList(JOB_TYPES)})`),
      check("jobs_status_valid", sql`${t.status} in (${sqlInList(JOB_STATUSES)})`),
      check("jobs_payload_size", sql`pg_column_size(${t.payload}) <= 1024`),
      check("jobs_result_size", sql`pg_column_size(${t.result}) <= 1024`),
      check("jobs_last_error_length", sql`char_length(${t.lastError}) <= 300`),
      check("jobs_attempts_valid", sql`${t.attempts} >= 0 and ${t.maxAttempts} between 1 and 20`),
      check("jobs_running_locked", sql`(${t.status} = 'running') = (${t.lockedAt} is not null)`),
    ],
  )
  .enableRLS();

/**
 * The SIMULATED partner-lender credit policy (Stage 12), versioned with
 * maker-checker: a risk admin proposes a version, a different one approves
 * it, and it becomes the single active version. No creator data. A real
 * lender's policy is the lender's; this exists only for the pilot.
 */
export const simulatedLenderPolicies = ops
  .table(
    "simulated_lender_policies",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      version: integer("version").notNull(),
      status: text("status", { enum: POLICY_STATUSES }).notNull(),
      rules: jsonb("rules").$type<Record<string, unknown>>().notNull(),
      note: text("note"),
      /** Null only for the seeded default. */
      proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "restrict" }),
      proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
      decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
      decidedAt: timestamp("decided_at", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("simulated_lender_policies_version_key").on(t.version),
      uniqueIndex("simulated_lender_policies_one_active")
        .on(t.status)
        .where(sql`${t.status} = 'active'`),
      check("simulated_lender_policies_status_valid", sql`${t.status} in (${sqlInList(POLICY_STATUSES)})`),
      check(
        "simulated_lender_policies_four_eyes",
        sql`${t.decidedBy} is null or ${t.proposedBy} is null or ${t.decidedBy} <> ${t.proposedBy}`,
      ),
      check(
        "simulated_lender_policies_decided",
        sql`${t.status} = 'proposed' or ${t.proposedBy} is null or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
      ),
      check("simulated_lender_policies_note_length", sql`${t.note} is null or char_length(${t.note}) <= 500`),
      check("simulated_lender_policies_rules_bounded", sql`pg_column_size(${t.rules}) <= 2048`),
    ],
  )
  .enableRLS();
