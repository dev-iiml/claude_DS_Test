import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  APPLICATION_STATUSES,
  BANK_ACCOUNT_TYPES,
  BUREAU_SCORE_BANDS,
  BUREAU_STATUSES,
  CASHFLOW_COVERAGE,
  CASHFLOW_SESSION_STATUSES,
  CASHFLOW_STATUSES,
  FINANCE_PURPOSES,
  MAX_PURPOSES,
  MISSING_ACCOUNT_REASONS,
  PURPOSE_NOTE_MAX,
  SHARED_ACCOUNT_STATUSES,
} from "@/modules/financial-eligibility/domain";
import { FRAUD_CATEGORIES, FRAUD_OUTCOMES, FRAUD_SEVERITIES } from "@/modules/fraud/rules";
import {
  DECISION_OUTCOMES,
  DECISION_SOURCES,
  OFFER_DECLINE_REASONS,
  OFFER_RESPONSES,
  HOLD_REASONS,
  PROPOSAL_STATUSES,
  REVIEW_ACTIONS,
  WITHDRAW_REASONS,
} from "@/modules/lending/domain";
import { FEATURE_CONFIDENCE, FEATURE_SOURCES } from "@/modules/professional-graph/domain";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { consentReceipts } from "./consent";
import { creatorProfiles } from "./creator-profile";
import { users } from "./identity";

/**
 * `fin` schema — the regulated financial domain, physically separate from the
 * creator-professional tables so it can be granted, retained and audited on
 * its own terms. Only `src/modules/financial-eligibility` reads or writes it.
 *
 * Stored: derived summaries (bureau score band and counts, monthly cashflow
 * totals, what the creator declared) and — Stage 09b, inside guardrails —
 * Account Aggregator line items and vendor analytics, encrypted and tied to
 * the AA consent's data-life (`fi_*` tables). Never raw bureau reports,
 * tradelines or a full PAN.
 */
export const fin = pgSchema("fin");

export const creditApplications = fin
  .table(
    "credit_applications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      creatorId: uuid("creator_id")
        .notNull()
        .references(() => creatorProfiles.id, { onDelete: "restrict" }),
      status: text("status", { enum: APPLICATION_STATUSES }).notNull().default("draft"),
      consentReceiptId: uuid("consent_receipt_id")
        .notNull()
        .references(() => consentReceipts.id, { onDelete: "restrict" }),
      /** Primary purpose (the first of `purposes`); kept on the tombstone for the creator's history. */
      purpose: text("purpose", { enum: FINANCE_PURPOSES }),
      /** Up to three purposes, in the creator's order. */
      purposes: text("purposes")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      /** Short note when "Something else" is chosen. Restricted: never logged or audited; erased with the inputs. */
      purposeNote: text("purpose_note"),
      /** INR, whole rupees. */
      requestedAmount: integer("requested_amount"),
      declaredMonthlyIncome: integer("declared_monthly_income"),
      declaredMonthlyEmi: integer("declared_monthly_emi"),
      incomeSources: text("income_sources")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      detailsCompletedAt: timestamp("details_completed_at", { withTimezone: true }),
      /** `XXXXX1234A` — the full PAN is used once for the bureau call and never stored. */
      panMasked: text("pan_masked"),
      /** `v1:` + HMAC-SHA256(PAN, server secret) — duplicate-identity detection only; not reversible without the secret. */
      panFingerprint: text("pan_fingerprint"),
      bureauStatus: text("bureau_status", { enum: BUREAU_STATUSES }).notNull().default("not_started"),
      cashflowStatus: text("cashflow_status", { enum: CASHFLOW_STATUSES }).notNull().default("not_started"),
      /** How much of the creator's banking the shared data covers (derived from accounts + the creator's answer). */
      cashflowCoverage: text("cashflow_coverage", { enum: CASHFLOW_COVERAGE }),
      /** "Have you shared every account where you receive creator income?" — null until answered. */
      accountsCompleteDeclared: boolean("accounts_complete_declared"),
      missingAccountsReason: text("missing_accounts_reason", { enum: MISSING_ACCOUNT_REASONS }),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      inputsReadyAt: timestamp("inputs_ready_at", { withTimezone: true }),
      /** The Financial Capacity run computed from the inputs the creator confirmed (cleared on reopen). */
      financialRunId: uuid("financial_run_id"),
      closedAt: timestamp("closed_at", { withTimezone: true }),
      /** Set when declared and fetched inputs are erased (withdrawal, expiry, closure). */
      inputsErasedAt: timestamp("inputs_erased_at", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index("credit_applications_user_idx").on(t.userId, t.createdAt.desc()),
      index("credit_applications_expiry_idx")
        .on(t.expiresAt)
        .where(sql`${t.status} in ('draft', 'inputs_ready')`),
      // One open check per creator at a time.
      uniqueIndex("credit_applications_one_open_key")
        .on(t.userId)
        .where(sql`${t.status} in ('draft', 'inputs_ready')`),
      check("credit_applications_status_valid", sql`${t.status} in (${sqlInList(APPLICATION_STATUSES)})`),
      check(
        "credit_applications_purpose_valid",
        sql`${t.purpose} is null or ${t.purpose} in (${sqlInList(FINANCE_PURPOSES)})`,
      ),
      check("credit_applications_bureau_status_valid", sql`${t.bureauStatus} in (${sqlInList(BUREAU_STATUSES)})`),
      check("credit_applications_cashflow_status_valid", sql`${t.cashflowStatus} in (${sqlInList(CASHFLOW_STATUSES)})`),
      check(
        "credit_applications_amounts_valid",
        sql`(${t.requestedAmount} is null or ${t.requestedAmount} between 10000 and 2500000)
          and (${t.declaredMonthlyIncome} is null or ${t.declaredMonthlyIncome} between 0 and 10000000)
          and (${t.declaredMonthlyEmi} is null or ${t.declaredMonthlyEmi} between 0 and 10000000)`,
      ),
      check("credit_applications_sources_bound", sql`cardinality(${t.incomeSources}) <= 6`),
      check(
        "credit_applications_purposes_valid",
        sql`cardinality(${t.purposes}) <= ${sql.raw(String(MAX_PURPOSES))}
          and ${t.purposes} <@ array[${sqlInList(FINANCE_PURPOSES)}]::text[]
          and (cardinality(${t.purposes}) = 0 or ${t.purposes}[1] = ${t.purpose})`,
      ),
      check(
        "credit_applications_purpose_note_valid",
        sql`${t.purposeNote} is null or (char_length(${t.purposeNote}) between 1 and ${sql.raw(String(PURPOSE_NOTE_MAX))}
          and 'other' = any(${t.purposes}))`,
      ),
      check(
        "credit_applications_coverage_valid",
        sql`(${t.cashflowCoverage} is null or ${t.cashflowCoverage} in (${sqlInList(CASHFLOW_COVERAGE)}))
          and (${t.missingAccountsReason} is null or (${t.missingAccountsReason} in (${sqlInList(MISSING_ACCOUNT_REASONS)})
            and ${t.accountsCompleteDeclared} = false))`,
      ),
      check(
        "credit_applications_pan_fingerprint_format",
        sql`${t.panFingerprint} is null or ${t.panFingerprint} ~ '^v[0-9]+:[0-9a-f]{64}$'`,
      ),
      index("credit_applications_pan_fingerprint_idx").on(t.panFingerprint),
      check(
        "credit_applications_pan_masked_format",
        sql`${t.panMasked} is null or ${t.panMasked} ~ '^X{5}[0-9]{4}[A-Z]$'`,
      ),
      check(
        "credit_applications_ready_is_whole",
        sql`${t.status} <> 'inputs_ready' or (
          ${t.detailsCompletedAt} is not null and ${t.bureauStatus} = 'completed'
          and ${t.cashflowStatus} in ('completed', 'skipped') and ${t.inputsReadyAt} is not null)`,
      ),
      check(
        "credit_applications_closed_has_timestamp",
        sql`${t.status} not in ('withdrawn', 'expired') or ${t.closedAt} is not null`,
      ),
      check(
        "credit_applications_erased_is_empty",
        sql`${t.inputsErasedAt} is null or (
          ${t.requestedAmount} is null and ${t.declaredMonthlyIncome} is null and ${t.declaredMonthlyEmi} is null
          and cardinality(${t.incomeSources}) = 0 and ${t.panMasked} is null and ${t.purposeNote} is null
          and ${t.panFingerprint} is null)`,
      ),
    ],
  )
  .enableRLS();

/** Derived bureau summary — never the report or tradelines. */
export const bureauSummaries = fin
  .table(
    "bureau_summaries",
    {
      applicationId: uuid("application_id")
        .primaryKey()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      provider: text("provider").notNull(),
      providerReference: text("provider_reference").notNull(),
      scoreBand: text("score_band", { enum: BUREAU_SCORE_BANDS }).notNull(),
      activeTradelines: integer("active_tradelines").notNull(),
      delinquentTradelines12m: integer("delinquent_tradelines_12m").notNull(),
      enquiries6m: integer("enquiries_6m").notNull(),
      retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      check("bureau_summaries_band_valid", sql`${t.scoreBand} in (${sqlInList(BUREAU_SCORE_BANDS)})`),
      check(
        "bureau_summaries_counts_non_negative",
        sql`${t.activeTradelines} >= 0 and ${t.delinquentTradelines12m} >= 0 and ${t.enquiries6m} >= 0`,
      ),
    ],
  )
  .enableRLS();

/** The check's monthly cashflow totals across every shared account (own-account transfers excluded). */
export const cashflowMonths = fin
  .table(
    "cashflow_months",
    {
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      month: date("month", { mode: "string" }).notNull(),
      inflowTotal: integer("inflow_total").notNull(),
      outflowTotal: integer("outflow_total").notNull(),
      creatorIncomeInflow: integer("creator_income_inflow"),
      /** Transfers between the creator's own shared accounts, left out of inflow and outflow. */
      ownTransfersExcluded: integer("own_transfers_excluded").notNull().default(0),
      /** Shared accounts with activity this month. */
      accountsContributing: integer("accounts_contributing").notNull().default(1),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("cashflow_months_application_month_key").on(t.applicationId, t.month),
      check("cashflow_months_first_of_month", sql`extract(day from ${t.month}) = 1`),
      check(
        "cashflow_months_non_negative",
        sql`${t.inflowTotal} >= 0 and ${t.outflowTotal} >= 0 and coalesce(${t.creatorIncomeInflow}, 0) >= 0
          and ${t.ownTransfersExcluded} >= 0 and ${t.accountsContributing} >= 0`,
      ),
    ],
  )
  .enableRLS();

/**
 * One Account Aggregator journey (Stage 09b): one mobile number searched,
 * accounts selected and approved at the AA. Several per check (another
 * number, or a retry). The number itself is never stored.
 */
export const cashflowSessions = fin
  .table(
    "cashflow_sessions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      /** Config key of the provider that issued the reference (the return leg must use the same one). */
      provider: text("provider").notNull(),
      /** Opaque provider reference for the AA consent (no personal data). */
      reference: text("reference").notNull(),
      mobileLast4: text("mobile_last4").notNull(),
      /** Keyed fingerprint of the number within this check (duplicate detection only). */
      mobileFingerprint: text("mobile_fingerprint").notNull(),
      retryOf: uuid("retry_of"),
      status: text("status", { enum: CASHFLOW_SESSION_STATUSES }).notNull().default("pending"),
      accountsSelected: integer("accounts_selected").notNull().default(0),
      accountsDelivered: integer("accounts_delivered").notNull().default(0),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("cashflow_sessions_reference_key").on(t.reference),
      index("cashflow_sessions_application_idx").on(t.applicationId, t.createdAt),
      check("cashflow_sessions_status_valid", sql`${t.status} in (${sqlInList(CASHFLOW_SESSION_STATUSES)})`),
      check("cashflow_sessions_provider_format", sql`${t.provider} ~ '^[a-z][a-z0-9_]{0,39}$'`),
      check("cashflow_sessions_last4_format", sql`${t.mobileLast4} ~ '^[0-9]{4}$'`),
      check("cashflow_sessions_fingerprint_format", sql`${t.mobileFingerprint} ~ '^v[0-9]+:[0-9a-f]{64}$'`),
      check(
        "cashflow_sessions_counts_valid",
        sql`${t.accountsSelected} >= 0 and ${t.accountsDelivered} between 0 and ${t.accountsSelected}`,
      ),
    ],
  )
  .enableRLS();

/**
 * A bank account the creator selected at the AA. One row per account per
 * check: the same account found through two numbers is kept once.
 */
export const cashflowAccounts = fin
  .table(
    "cashflow_accounts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => cashflowSessions.id, { onDelete: "cascade" }),
      /** sha256(institution, type, masked number): the same account through two numbers dedupes. */
      dedupeKey: text("dedupe_key").notNull(),
      maskedNumber: text("masked_number").notNull(),
      institution: text("institution").notNull(),
      accountType: text("account_type", { enum: BANK_ACCOUNT_TYPES }).notNull(),
      discoveredViaLast4: text("discovered_via_last4").notNull(),
      status: text("status", { enum: SHARED_ACCOUNT_STATUSES }).notNull(),
      periodFrom: date("period_from", { mode: "string" }),
      periodTo: date("period_to", { mode: "string" }),
      /** Line items for this account are held in fin.fi_transactions (until data-life ends). */
      transactionsRetained: boolean("transactions_retained").notNull().default(false),
      dataLifeUntil: timestamp("data_life_until", { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex("cashflow_accounts_dedupe_key").on(t.applicationId, t.dedupeKey),
      check("cashflow_accounts_status_valid", sql`${t.status} in (${sqlInList(SHARED_ACCOUNT_STATUSES)})`),
      check("cashflow_accounts_type_valid", sql`${t.accountType} in (${sqlInList(BANK_ACCOUNT_TYPES)})`),
      check("cashflow_accounts_masked_format", sql`${t.maskedNumber} ~ '^[X*]{0,16}[0-9]{2,6}$'`),
      check("cashflow_accounts_last4_format", sql`${t.discoveredViaLast4} ~ '^[0-9]{4}$'`),
      check("cashflow_accounts_institution_length", sql`char_length(${t.institution}) between 1 and 120`),
      check("cashflow_accounts_dedupe_format", sql`${t.dedupeKey} ~ '^[0-9a-f]{64}$'`),
      check(
        "cashflow_accounts_retained_needs_life",
        sql`not ${t.transactionsRetained} or (${t.dataLifeUntil} is not null and ${t.status} = 'delivered')`,
      ),
    ],
  )
  .enableRLS();

/** Monthly totals per shared account, from the cashflow analysis (`analysis_version`). */
export const cashflowAccountMonths = fin
  .table(
    "cashflow_account_months",
    {
      accountId: uuid("account_id")
        .notNull()
        .references(() => cashflowAccounts.id, { onDelete: "cascade" }),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      month: date("month", { mode: "string" }).notNull(),
      analysisVersion: text("analysis_version").notNull(),
      inflowTotal: integer("inflow_total").notNull(),
      outflowTotal: integer("outflow_total").notNull(),
      creatorIncome: integer("creator_income").notNull(),
      ownTransfersIn: integer("own_transfers_in").notNull(),
      ownTransfersOut: integer("own_transfers_out").notNull(),
      transactionCount: integer("transaction_count").notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("cashflow_account_months_key").on(t.accountId, t.month),
      index("cashflow_account_months_application_idx").on(t.applicationId),
      check("cashflow_account_months_first_of_month", sql`extract(day from ${t.month}) = 1`),
      check(
        "cashflow_account_months_non_negative",
        sql`${t.inflowTotal} >= 0 and ${t.outflowTotal} >= 0 and ${t.creatorIncome} between 0 and ${t.inflowTotal}
          and ${t.ownTransfersIn} >= 0 and ${t.ownTransfersOut} >= 0 and ${t.transactionCount} >= 0`,
      ),
    ],
  )
  .enableRLS();

/**
 * AA line items, inside guardrails (Stage 09b): narration and counterparty
 * encrypted (AES-256-GCM, bound to the check); deleted when the consent's
 * data-life ends or the check's inputs are erased. Append-only otherwise.
 * Live data is stored only when FI_LIVE_LINE_ITEM_RETENTION is on.
 */
export const fiTransactions = fin
  .table(
    "fi_transactions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      accountId: uuid("account_id")
        .notNull()
        .references(() => cashflowAccounts.id, { onDelete: "cascade" }),
      /** sha256(account, provider txn id) — duplicates only; the provider id isn't kept. */
      txnRefHash: text("txn_ref_hash").notNull(),
      bookedOn: date("booked_on", { mode: "string" }).notNull(),
      amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
      direction: text("direction", { enum: ["credit", "debit"] }).notNull(),
      mode: text("mode").notNull(),
      narrationSealed: text("narration_sealed").notNull(),
      counterpartySealed: text("counterparty_sealed"),
      dataLifeUntil: timestamp("data_life_until", { withTimezone: true }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("fi_transactions_account_ref_key").on(t.accountId, t.txnRefHash),
      index("fi_transactions_data_life_idx").on(t.dataLifeUntil),
      index("fi_transactions_application_idx").on(t.applicationId),
      check("fi_transactions_direction_valid", sql`${t.direction} in ('credit', 'debit')`),
      check("fi_transactions_amount_positive", sql`${t.amount} > 0`),
      check("fi_transactions_mode_format", sql`${t.mode} ~ '^[a-z]{2,10}$'`),
      check("fi_transactions_hash_format", sql`${t.txnRefHash} ~ '^[0-9a-f]{64}$'`),
      check("fi_transactions_sealed_format", sql`${t.narrationSealed} like 'v1.%'`),
    ],
  )
  .enableRLS();

/** The AA/FIU vendor's own analytics for an account (encrypted), under the same data-life. Append-only. */
export const fiVendorAnalytics = fin
  .table(
    "fi_vendor_analytics",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      accountId: uuid("account_id")
        .notNull()
        .references(() => cashflowAccounts.id, { onDelete: "cascade" }),
      provider: text("provider").notNull(),
      payloadSealed: text("payload_sealed").notNull(),
      dataLifeUntil: timestamp("data_life_until", { withTimezone: true }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("fi_vendor_analytics_account_key").on(t.accountId),
      index("fi_vendor_analytics_data_life_idx").on(t.dataLifeUntil),
      check("fi_vendor_analytics_sealed_format", sql`${t.payloadSealed} like 'v1.%'`),
    ],
  )
  .enableRLS();

/** One Financial Capacity computation; identical inputs reuse the run (reproducibility). */
export const financialFeatureRuns = fin
  .table(
    "financial_feature_runs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      engineVersion: text("engine_version").notNull(),
      inputsHash: text("inputs_hash").notNull(),
      computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("financial_feature_runs_identity_key").on(t.applicationId, t.engineVersion, t.inputsHash),
      check("financial_feature_runs_hash_format", sql`${t.inputsHash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

export const financialFeatures = fin
  .table(
    "financial_features",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      runId: uuid("run_id")
        .notNull()
        .references(() => financialFeatureRuns.id, { onDelete: "cascade" }),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      featureKey: text("feature_key").notNull(),
      featureVersion: text("feature_version").notNull(),
      valueNumeric: numeric("value_numeric", { precision: 18, scale: 6 }),
      valueText: text("value_text"),
      unit: text("unit").notNull(),
      source: text("source", { enum: FEATURE_SOURCES }).notNull(),
      completeness: numeric("completeness", { precision: 4, scale: 3 }).notNull(),
      confidence: text("confidence", { enum: FEATURE_CONFIDENCE }).notNull(),
      provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("financial_features_run_key").on(t.runId, t.featureKey),
      check("financial_features_source_valid", sql`${t.source} in (${sqlInList(FEATURE_SOURCES)})`),
      check("financial_features_confidence_valid", sql`${t.confidence} in (${sqlInList(FEATURE_CONFIDENCE)})`),
      check("financial_features_single_value", sql`${t.valueNumeric} is null or ${t.valueText} is null`),
      check("financial_features_completeness_range", sql`${t.completeness} between 0 and 1`),
      check("financial_features_provenance_bounded", sql`pg_column_size(${t.provenance}) <= 2048`),
    ],
  )
  .enableRLS();

/**
 * One underwriting run (Stage 10): a frozen input snapshot scored by both
 * models. (application, model_version, inputs_hash) is unique, so identical
 * inputs reuse the run. Append-only; erased with the check's inputs.
 */
export const underwritingRuns = fin
  .table(
    "underwriting_runs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      modelVersion: text("model_version").notNull(),
      inputsHash: text("inputs_hash").notNull(),
      financialRunId: uuid("financial_run_id").notNull(),
      /** The Professional Graph run used, if creator signals were available. */
      professionalRunId: uuid("professional_run_id"),
      computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("underwriting_runs_identity_key").on(t.applicationId, t.modelVersion, t.inputsHash),
      index("underwriting_runs_application_idx").on(t.applicationId, t.computedAt.desc()),
      check("underwriting_runs_hash_format", sql`${t.inputsHash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

/** The exact feature values a run used (copied, so the run survives later data changes). */
export const underwritingInputs = fin
  .table(
    "underwriting_inputs",
    {
      runId: uuid("run_id")
        .notNull()
        .references(() => underwritingRuns.id, { onDelete: "cascade" }),
      featureKey: text("feature_key").notNull(),
      /** `financial` (fin domain) or `professional` (Creator Professional Graph) or `application`. */
      origin: text("origin").notNull(),
      valueNumeric: numeric("value_numeric", { precision: 18, scale: 6 }),
      valueText: text("value_text"),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("underwriting_inputs_run_key").on(t.runId, t.featureKey),
      check("underwriting_inputs_origin_valid", sql`${t.origin} in ('financial', 'professional', 'application')`),
      check("underwriting_inputs_single_value", sql`${t.valueNumeric} is null or ${t.valueText} is null`),
    ],
  )
  .enableRLS();

export const underwritingResults = fin
  .table(
    "underwriting_results",
    {
      runId: uuid("run_id")
        .notNull()
        .references(() => underwritingRuns.id, { onDelete: "cascade" }),
      model: text("model").notNull(),
      score: numeric("score", { precision: 5, scale: 1 }),
      grade: text("grade"),
      completeness: numeric("completeness", { precision: 4, scale: 3 }).notNull(),
      confidence: text("confidence", { enum: FEATURE_CONFIDENCE }).notNull(),
      outcome: text("outcome").notNull(),
      incomeBasis: integer("income_basis"),
      incomeBasisSource: text("income_basis_source"),
      recommendedExposure: integer("recommended_exposure"),
      maxRecommendedExposure: integer("max_recommended_exposure"),
      recommendedTenorMonths: integer("recommended_tenor_months"),
      /** Component scores, e.g. { financial_strength: 72.5, brand_recurrence: null }. */
      components: jsonb("components").$type<Record<string, number | null>>().notNull(),
      reasonCodes: jsonb("reason_codes").$type<{ code: string; effect: string; component: string }[]>().notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("underwriting_results_run_model_key").on(t.runId, t.model),
      check("underwriting_results_model_valid", sql`${t.model} in ('traditional', 'creator_enhanced')`),
      check("underwriting_results_grade_valid", sql`${t.grade} is null or ${t.grade} in ('A', 'B', 'C', 'D', 'E')`),
      check("underwriting_results_outcome_valid", sql`${t.outcome} in ('recommend', 'refer', 'not_recommended')`),
      check("underwriting_results_score_range", sql`${t.score} is null or ${t.score} between 0 and 100`),
      check(
        "underwriting_results_bounded",
        sql`pg_column_size(${t.components}) <= 1024 and pg_column_size(${t.reasonCodes}) <= 4096`,
      ),
    ],
  )
  .enableRLS();

/**
 * Fraud / authenticity check for an underwriting run (Stage 11): a separate
 * layer, never a weighted score. Inputs are numbers/booleans only, so the
 * check is reproducible from this row. Append-only; erased with the run.
 */
export const fraudChecks = fin
  .table(
    "fraud_checks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      runId: uuid("run_id")
        .notNull()
        .references(() => underwritingRuns.id, { onDelete: "cascade" }),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      rulesVersion: text("rules_version").notNull(),
      outcome: text("outcome", { enum: FRAUD_OUTCOMES }).notNull(),
      highestSeverity: text("highest_severity", { enum: FRAUD_SEVERITIES }),
      inputs: jsonb("inputs").$type<Record<string, number | boolean | null>>().notNull(),
      /** Which checks ran: [{ code, status: passed | flagged | not_run }]. */
      checks: jsonb("checks").$type<{ code: string; status: string }[]>().notNull(),
      computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("fraud_checks_run_key").on(t.runId),
      index("fraud_checks_application_idx").on(t.applicationId),
      check("fraud_checks_outcome_valid", sql`${t.outcome} in (${sqlInList(FRAUD_OUTCOMES)})`),
      check(
        "fraud_checks_severity_valid",
        sql`${t.highestSeverity} is null or ${t.highestSeverity} in (${sqlInList(FRAUD_SEVERITIES)})`,
      ),
      check(
        "fraud_checks_outcome_matches_severity",
        sql`(${t.outcome} = 'clear') = (${t.highestSeverity} is null) and (${t.outcome} = 'review') = (${t.highestSeverity} = 'high')`,
      ),
      check("fraud_checks_bounded", sql`pg_column_size(${t.inputs}) <= 1024 and pg_column_size(${t.checks}) <= 2048`),
    ],
  )
  .enableRLS();

export const fraudFlags = fin
  .table(
    "fraud_flags",
    {
      checkId: uuid("check_id")
        .notNull()
        .references(() => fraudChecks.id, { onDelete: "cascade" }),
      code: text("code").notNull(),
      category: text("category", { enum: FRAUD_CATEGORIES }).notNull(),
      severity: text("severity", { enum: FRAUD_SEVERITIES }).notNull(),
      /** Numbers/booleans that triggered the flag (e.g. { name_match: 0.3 }). Never names or identifiers. */
      evidence: jsonb("evidence").$type<Record<string, number | boolean | null>>().notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("fraud_flags_check_code_key").on(t.checkId, t.code),
      index("fraud_flags_code_idx").on(t.code),
      check("fraud_flags_code_format", sql`${t.code} ~ '^[A-Z][A-Z0-9_]{2,63}$'`),
      check("fraud_flags_category_valid", sql`${t.category} in (${sqlInList(FRAUD_CATEGORIES)})`),
      check("fraud_flags_severity_valid", sql`${t.severity} in (${sqlInList(FRAUD_SEVERITIES)})`),
      check("fraud_flags_evidence_bounded", sql`pg_column_size(${t.evidence}) <= 512`),
    ],
  )
  .enableRLS();

/**
 * A credit proposal to a partner lender (Stage 12). The payload is exactly
 * what was (or will be) sent, frozen at creation — immutable afterwards.
 * Unsent proposals are deleted with the check's erasure; sent ones follow the
 * lender's retention rules (the check is `submitted`).
 */
export const creditProposals = fin
  .table(
    "credit_proposals",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => creditApplications.id, { onDelete: "cascade" }),
      underwritingRunId: uuid("underwriting_run_id")
        .notNull()
        .references(() => underwritingRuns.id, { onDelete: "cascade" }),
      /** Config key of the lender the proposal is for. */
      lender: text("lender").notNull(),
      status: text("status", { enum: PROPOSAL_STATUSES }).notNull(),
      holdReason: text("hold_reason", { enum: HOLD_REASONS }),
      dataGroups: text("data_groups").array().notNull(),
      /** The "Share with a partner lender" receipt the proposal relies on. */
      consentReceiptId: uuid("consent_receipt_id")
        .notNull()
        .references(() => consentReceipts.id, { onDelete: "restrict" }),
      payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
      payloadHash: text("payload_hash").notNull(),
      /** Simulated lender policy version sent with it (mock lenders only). */
      policyVersion: integer("policy_version"),
      lenderReference: text("lender_reference"),
      attempts: integer("attempts").notNull().default(0),
      nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
      /** Error class only (never a payload or message from the lender). */
      lastError: text("last_error"),
      releasedBy: uuid("released_by").references(() => users.id, { onDelete: "restrict" }),
      releasedAt: timestamp("released_at", { withTimezone: true }),
      releaseReason: text("release_reason"),
      submittedAt: timestamp("submitted_at", { withTimezone: true }),
      withdrawnReason: text("withdrawn_reason", { enum: WITHDRAW_REASONS }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index("credit_proposals_application_idx").on(t.applicationId, t.createdAt.desc()),
      index("credit_proposals_status_idx").on(t.status, t.nextAttemptAt),
      // One live proposal per underwriting run.
      // One proposal per underwriting run (a failed one blocks a new one until staff retry it).
      uniqueIndex("credit_proposals_run_key")
        .on(t.underwritingRunId)
        .where(sql`${t.status} <> 'withdrawn'`),
      uniqueIndex("credit_proposals_lender_reference_key").on(t.lender, t.lenderReference),
      check("credit_proposals_status_valid", sql`${t.status} in (${sqlInList(PROPOSAL_STATUSES)})`),
      check("credit_proposals_hold_valid", sql`${t.status} <> 'held' or ${t.holdReason} is not null`),
      check(
        "credit_proposals_release_valid",
        sql`(${t.releasedAt} is null) = (${t.releasedBy} is null) and (${t.releasedAt} is null) = (${t.releaseReason} is null)
          and (${t.releasedAt} is null or ${t.holdReason} is not null)`,
      ),
      check("credit_proposals_withdrawn_valid", sql`(${t.status} = 'withdrawn') = (${t.withdrawnReason} is not null)`),
      check(
        "credit_proposals_sent_has_reference",
        sql`${t.status} not in ('submitted', 'decided') or (${t.lenderReference} is not null and ${t.submittedAt} is not null)`,
      ),
      check(
        "credit_proposals_release_reason",
        sql`${t.releaseReason} is null or char_length(${t.releaseReason}) between 3 and 500`,
      ),
      check("credit_proposals_hash_format", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
      check("credit_proposals_lender_format", sql`${t.lender} ~ '^[a-z][a-z0-9_]{0,39}$'`),
      check("credit_proposals_payload_bounded", sql`pg_column_size(${t.payload}) <= 32768`),
      check("credit_proposals_attempts_range", sql`${t.attempts} between 0 and 50`),
    ],
  )
  .enableRLS();

/** The lender's decision on a proposal, as received. Append-only. */
export const lenderDecisions = fin
  .table(
    "lender_decisions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      proposalId: uuid("proposal_id")
        .notNull()
        .references(() => creditProposals.id, { onDelete: "cascade" }),
      lenderReference: text("lender_reference").notNull(),
      outcome: text("outcome", { enum: DECISION_OUTCOMES }).notNull(),
      approvedExposure: integer("approved_exposure"),
      approvedTenorMonths: integer("approved_tenor_months"),
      decisionBasis: text("decision_basis"),
      policyVersion: integer("policy_version"),
      reasonCodes: text("reason_codes").array().notNull(),
      decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
      receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
      /** 1 for the first decision; a partner posts a new revision only in answer to a CreatorCo query (12b). */
      revision: integer("revision").notNull().default(1),
      /** How it arrived: the lender adapter answered a poll, or the partner posted it to the partner API. */
      source: text("source", { enum: DECISION_SOURCES }).notNull().default("lender_poll"),
      /** Partner API only: the caller's Idempotency-Key and a hash of the request body. */
      idempotencyKey: text("idempotency_key"),
      requestHash: text("request_hash"),
      /** Partner API only: the public prefix of the API key used (never the key). */
      apiKeyPrefix: text("api_key_prefix"),
      /** Stage 13: the lender's offer terms and KFS (`offerTermsSchema`), and until when they stand. */
      offerTerms: jsonb("offer_terms").$type<Record<string, unknown>>(),
      offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("lender_decisions_revision_key").on(t.proposalId, t.revision),
      uniqueIndex("lender_decisions_idempotency_key")
        .on(t.proposalId, t.idempotencyKey)
        .where(sql`${t.idempotencyKey} is not null`),
      check("lender_decisions_revision_positive", sql`${t.revision} >= 1`),
      check(
        "lender_decisions_offer_shape",
        sql`(${t.offerTerms} is null) = (${t.offerExpiresAt} is null)
          and (${t.outcome} <> 'declined' or ${t.offerTerms} is null)
          and (${t.offerTerms} is null or pg_column_size(${t.offerTerms}) <= 4096)`,
      ),
      check("lender_decisions_source_valid", sql`${t.source} in (${sqlInList(DECISION_SOURCES)})`),
      check(
        "lender_decisions_partner_fields",
        sql`(${t.source} = 'partner_api') = (${t.idempotencyKey} is not null and ${t.requestHash} is not null and ${t.apiKeyPrefix} is not null)`,
      ),
      check(
        "lender_decisions_idempotency_format",
        sql`${t.idempotencyKey} is null or ${t.idempotencyKey} ~ '^[A-Za-z0-9_.:-]{8,100}$'`,
      ),
      check("lender_decisions_outcome_valid", sql`${t.outcome} in (${sqlInList(DECISION_OUTCOMES)})`),
      check(
        "lender_decisions_amounts_match_outcome",
        sql`(${t.outcome} = 'declined') = (${t.approvedExposure} is null)
          and (${t.approvedExposure} is null or ${t.approvedExposure} > 0)`,
      ),
      check(
        "lender_decisions_basis_valid",
        sql`${t.decisionBasis} is null or ${t.decisionBasis} in ('traditional', 'creator_enhanced')`,
      ),
      check("lender_decisions_reasons_bounded", sql`cardinality(${t.reasonCodes}) <= 20`),
    ],
  )
  .enableRLS();

/**
 * A CreatorCo risk admin confirms or overrides the lender's decision before
 * the creator sees it (user decision). One review per decision; overrides
 * need a reason. Append-only.
 */
export const decisionReviews = fin
  .table(
    "decision_reviews",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      decisionId: uuid("decision_id")
        .notNull()
        .references(() => lenderDecisions.id, { onDelete: "cascade" }),
      proposalId: uuid("proposal_id")
        .notNull()
        .references(() => creditProposals.id, { onDelete: "cascade" }),
      reviewerId: uuid("reviewer_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      action: text("action", { enum: REVIEW_ACTIONS }).notNull(),
      finalOutcome: text("final_outcome", { enum: DECISION_OUTCOMES }).notNull(),
      finalExposure: integer("final_exposure"),
      finalTenorMonths: integer("final_tenor_months"),
      reason: text("reason"),
      /** Stage 13: the offer the creator is shown (the lender's, or re-priced for a simulated override). */
      finalOfferTerms: jsonb("final_offer_terms").$type<Record<string, unknown>>(),
      finalOfferExpiresAt: timestamp("final_offer_expires_at", { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("decision_reviews_decision_key").on(t.decisionId),
      // A reviewed decision is final: there is never a later revision to review.
      uniqueIndex("decision_reviews_proposal_key").on(t.proposalId),
      check(
        "decision_reviews_offer_shape",
        sql`(${t.finalOfferTerms} is null) = (${t.finalOfferExpiresAt} is null)
          and (${t.finalOutcome} <> 'declined' or ${t.finalOfferTerms} is null)
          and (${t.finalOfferTerms} is null or pg_column_size(${t.finalOfferTerms}) <= 4096)`,
      ),
      check("decision_reviews_action_valid", sql`${t.action} in (${sqlInList(REVIEW_ACTIONS)})`),
      check("decision_reviews_outcome_valid", sql`${t.finalOutcome} in (${sqlInList(DECISION_OUTCOMES)})`),
      check(
        "decision_reviews_override_has_reason",
        sql`${t.action} <> 'override' or (${t.reason} is not null and char_length(${t.reason}) between 10 and 500)`,
      ),
      check(
        "decision_reviews_amounts_match_outcome",
        sql`(${t.finalOutcome} = 'declined') = (${t.finalExposure} is null)
          and (${t.finalExposure} is null or ${t.finalExposure} between 10000 and 2500000)
          and (${t.finalTenorMonths} is null or ${t.finalTenorMonths} between 3 and 60)`,
      ),
    ],
  )
  .enableRLS();

/**
 * A CreatorCo reviewer's query on a partner lender's decision (Stage 12b, user
 * decision: staff confirm or query partner decisions, never change them). The
 * partner reads the message through the partner API and answers with a new
 * decision revision, which resolves the query. At most one open query per
 * proposal. A risk admin can withdraw an unanswered query (with a reason), so
 * an unresponsive partner never blocks the review. Only the resolution fields
 * may be set, once (trigger).
 */
export const decisionQueries = fin
  .table(
    "decision_queries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      proposalId: uuid("proposal_id")
        .notNull()
        .references(() => creditProposals.id, { onDelete: "cascade" }),
      decisionId: uuid("decision_id")
        .notNull()
        .references(() => lenderDecisions.id, { onDelete: "cascade" }),
      raisedBy: uuid("raised_by")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      /** Sent to the partner lender as written. */
      message: text("message").notNull(),
      resolvedDecisionId: uuid("resolved_decision_id").references(() => lenderDecisions.id, { onDelete: "cascade" }),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }),
      /** Closed by a risk admin without an answer (partner unresponsive or suspended), with a reason. */
      withdrawnBy: uuid("withdrawn_by").references(() => users.id, { onDelete: "restrict" }),
      withdrawnReason: text("withdrawn_reason"),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("decision_queries_decision_key").on(t.decisionId),
      uniqueIndex("decision_queries_one_open")
        .on(t.proposalId)
        .where(sql`${t.resolvedAt} is null`),
      check("decision_queries_message_length", sql`char_length(${t.message}) between 10 and 500`),
      check(
        "decision_queries_resolved",
        sql`(${t.resolvedAt} is null) = (${t.resolvedDecisionId} is null and ${t.withdrawnBy} is null)
          and (${t.resolvedDecisionId} is null or ${t.withdrawnBy} is null)
          and (${t.withdrawnBy} is null) = (${t.withdrawnReason} is null)`,
      ),
      check(
        "decision_queries_withdrawn_reason",
        sql`${t.withdrawnReason} is null or char_length(${t.withdrawnReason}) between 10 and 500`,
      ),
    ],
  )
  .enableRLS();

/**
 * The creator's answer to a reviewed offer (Stage 13). One per proposal;
 * append-only. An acceptance records the exact terms shown (hash) and the
 * "Continue with the partner lender" consent receipt it relies on; the
 * partner lender then completes KYC, the agreement, eSign and disbursal.
 */
export const offerResponses = fin
  .table(
    "offer_responses",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      proposalId: uuid("proposal_id")
        .notNull()
        .references(() => creditProposals.id, { onDelete: "cascade" }),
      reviewId: uuid("review_id")
        .notNull()
        .references(() => decisionReviews.id, { onDelete: "cascade" }),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
      response: text("response", { enum: OFFER_RESPONSES }).notNull(),
      /** SHA-256 of the canonical terms the creator saw. */
      termsHash: text("terms_hash").notNull(),
      kfsAcknowledged: boolean("kfs_acknowledged").notNull().default(false),
      handoffReceiptId: uuid("handoff_receipt_id").references(() => consentReceipts.id, { onDelete: "restrict" }),
      declineReason: text("decline_reason", { enum: OFFER_DECLINE_REASONS }),
      respondedAt: timestamp("responded_at", { withTimezone: true }).notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("offer_responses_proposal_key").on(t.proposalId),
      check("offer_responses_response_valid", sql`${t.response} in (${sqlInList(OFFER_RESPONSES)})`),
      check("offer_responses_hash_format", sql`${t.termsHash} ~ '^[0-9a-f]{64}$'`),
      check(
        "offer_responses_accept_shape",
        sql`(${t.response} = 'accepted') = (${t.handoffReceiptId} is not null and ${t.kfsAcknowledged})
          and (${t.response} = 'declined' or ${t.declineReason} is null)`,
      ),
      check(
        "offer_responses_decline_reason_valid",
        sql`${t.declineReason} is null or ${t.declineReason} in (${sqlInList(OFFER_DECLINE_REASONS)})`,
      ),
    ],
  )
  .enableRLS();
