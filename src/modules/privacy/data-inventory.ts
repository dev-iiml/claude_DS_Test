import type { ErasureScope } from "@/modules/consent/domain";

/**
 * Data inventory and classification (Stage 16) — pure, the single source for
 * docs/DATA_CLASSIFICATION.md. Every table in the database is listed with its
 * domain, sensitivity, whether it holds personal data and how it leaves the
 * system. A test fails when a table is added without an entry here.
 *
 * Sensitivity:
 * - `restricted`: identity or financial data whose exposure causes real harm
 *   (PAN-derived values, mobile numbers, bank/bureau-derived figures,
 *   credentials). Encrypted or hashed where possible; never logged or sent
 *   to analytics; only the owning module reads it.
 * - `confidential`: personal or creator-professional data, consent and audit
 *   records.
 * - `internal`: operational data with no personal data, or only opaque ids.
 * - `public`: reference content shown to every member.
 */
export type DataDomain =
  | "identity"
  | "creator_professional"
  | "consent"
  | "regulated_financial"
  | "access"
  | "analytics"
  | "audit"
  | "control_plane"
  | "reference";

export type Sensitivity = "restricted" | "confidential" | "internal" | "public";

export interface TableEntry {
  table: string;
  domain: DataDomain;
  sensitivity: Sensitivity;
  personal: boolean;
  /** What it holds, in a few words. */
  holds: string;
  /** Consent-withdrawal scopes that erase it (subject to retention holds). */
  erasedBy?: readonly ErasureScope[];
  /** Automatic deletion, if any. */
  purge?: string;
  /** Why it's kept when no scope or purge removes it. */
  retained?: string;
}

const KEPT_WITH_ACCOUNT = "kept while the account exists (account closure: open item)";

export const DATA_INVENTORY: readonly TableEntry[] = [
  // Identity (public + iam)
  {
    table: "public.users",
    domain: "identity",
    sensitivity: "restricted",
    personal: true,
    holds: "email, verified mobile, role, status",
    retained: KEPT_WITH_ACCOUNT,
  },
  {
    table: "iam.identities",
    domain: "identity",
    sensitivity: "restricted",
    personal: true,
    holds: "email, password hash (scrypt)",
    retained: KEPT_WITH_ACCOUNT,
  },
  {
    table: "iam.sessions",
    domain: "identity",
    sensitivity: "restricted",
    personal: true,
    holds: "session token hash, client, expiry",
    purge: "180 days after the session ends (purge_auth_records)",
  },
  {
    table: "iam.login_attempts",
    domain: "identity",
    sensitivity: "confidential",
    personal: true,
    holds: "hashed email, success flag",
    purge: "after 180 days (purge_auth_records)",
  },
  {
    table: "public.mobile_verifications",
    domain: "identity",
    sensitivity: "restricted",
    personal: true,
    holds: "mobile number, code hash, attempts",
    purge: "after 30 days (purge_auth_records)",
  },
  {
    table: "public.identity_lookup_results",
    domain: "identity",
    sensitivity: "restricted",
    personal: true,
    holds: "verified name, masked PAN, mobile",
    erasedBy: ["identity_lookup"],
  },

  // Creator-professional domain
  {
    table: "public.creator_profiles",
    domain: "creator_professional",
    sensitivity: "restricted",
    personal: true,
    holds: "legal/display name, location, legal form, GST status, GSTIN",
    retained: `${KEPT_WITH_ACCOUNT}; withdrawing Creator Profile pauses membership`,
  },
  {
    table: "public.creator_gst_registrations",
    domain: "creator_professional",
    sensitivity: "restricted",
    personal: true,
    holds: "GSTIN (embeds PAN), registered names, state",
    retained: KEPT_WITH_ACCOUNT,
  },
  {
    table: "public.creator_additional_categories",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "category codes",
    retained: KEPT_WITH_ACCOUNT,
  },
  {
    table: "public.creator_preferences",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "category, brand, travel and PR interests",
    retained: KEPT_WITH_ACCOUNT,
  },
  {
    table: "public.creator_social_accounts",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "platform, handle, provider account id",
    erasedBy: ["social_account_data"],
  },
  {
    table: "public.creator_social_snapshots",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "follower, view, reach and engagement figures",
    erasedBy: ["social_account_data"],
  },
  {
    table: "public.social_connection_requests",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "hashed OAuth state, platform",
    erasedBy: ["social_account_data"],
  },
  {
    table: "public.professional_graph_runs",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "graph run metadata",
    erasedBy: ["professional_graph"],
  },
  {
    table: "public.creator_professional_features",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "derived professional features with provenance",
    erasedBy: ["professional_graph", "brand_work_records"],
  },
  {
    table: "public.creator_status_runs",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "Creator Status tier and criteria",
    erasedBy: ["professional_graph"],
  },
  {
    table: "public.creator_points_ledger",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "Creator Points earn/hold/release/reverse entries (rule codes and ids only)",
    retained: KEPT_WITH_ACCOUNT,
  },
  {
    table: "public.points_tasks",
    domain: "creator_professional",
    sensitivity: "internal",
    personal: false,
    holds: "staff-defined points tasks (title, description, points, four-eyes status)",
    retained: "kept while useful; retired, never deleted (completions point to them)",
  },
  {
    table: "public.points_task_completions",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "which creator completed which task, when, and a short staff note (no identifiers)",
    retained: KEPT_WITH_ACCOUNT,
  },

  // Verified brand work (Stage 18)
  {
    table: "public.brand_work_records",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "brand collaborations: brand, billed party, platforms, deliverables, dates, invoice amount, review state",
    erasedBy: ["brand_work_records", "brand_payment_matches"],
  },
  {
    table: "public.brand_work_documents",
    domain: "creator_professional",
    sensitivity: "restricted",
    personal: true,
    holds:
      "document metadata only (kind, opaque storage key, SHA-256, size, scan verdict); the bytes — which can contain PAN, GSTIN, bank details — live only in document storage",
    erasedBy: ["brand_work_records"],
  },
  {
    table: "public.brand_work_reviews",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "append-only reviewer actions (codes, short staff notes checked for identifiers)",
    erasedBy: ["brand_work_records"],
  },
  {
    table: "public.brand_work_reversals",
    domain: "creator_professional",
    sensitivity: "confidential",
    personal: true,
    holds: "four-eyes reversal proposals and decisions",
    erasedBy: ["brand_work_records"],
  },
  {
    table: "public.creator_notices",
    domain: "creator_professional",
    sensitivity: "internal",
    personal: true,
    holds: "neutral in-app notices (kind and a date), refreshed daily",
    erasedBy: ["brand_work_records"],
    purge: "replaced by the daily reminder job",
  },
  {
    table: "public.brand_directory",
    domain: "reference",
    sensitivity: "internal",
    personal: false,
    holds: "canonical brand names and industries (business data)",
    retained: "kept as reference data; merged, never deleted",
  },
  {
    table: "public.brand_aliases",
    domain: "reference",
    sensitivity: "internal",
    personal: false,
    holds: "normalised brand-name aliases",
    retained: "kept as reference data",
  },
  {
    table: "public.brand_directory_merges",
    domain: "reference",
    sensitivity: "internal",
    personal: false,
    holds: "four-eyes merges of duplicate brands",
    retained: "kept as an audit of reference data",
  },
  {
    table: "public.brand_industries",
    domain: "reference",
    sensitivity: "public",
    personal: false,
    holds: "brand industry vocabulary",
  },
  {
    table: "public.brand_work_reasons",
    domain: "reference",
    sensitivity: "public",
    personal: false,
    holds: "review reason vocabulary",
  },

  // Access preview
  {
    table: "public.brands",
    domain: "reference",
    sensitivity: "public",
    personal: false,
    holds: "sample brand names and descriptions",
  },
  {
    table: "public.access_opportunities",
    domain: "reference",
    sensitivity: "public",
    personal: false,
    holds: "sample opportunities",
  },
  {
    table: "public.access_requests",
    domain: "access",
    sensitivity: "confidential",
    personal: true,
    holds: "requests, notes, points held, completion date",
    erasedBy: ["access_requests"],
  },

  // Consent
  {
    table: "public.consent_definitions",
    domain: "reference",
    sensitivity: "public",
    personal: false,
    holds: "versioned consent texts",
  },
  {
    table: "public.consent_receipts",
    domain: "consent",
    sensitivity: "confidential",
    personal: true,
    holds: "who agreed to which version, when",
    retained: "proof of consent (counsel to confirm the period)",
  },
  {
    table: "public.consent_withdrawals",
    domain: "consent",
    sensitivity: "confidential",
    personal: true,
    holds: "withdrawals, reason code, effects",
    retained: "proof of withdrawal (counsel to confirm the period)",
  },
  {
    table: "public.data_erasure_requests",
    domain: "consent",
    sensitivity: "internal",
    personal: true,
    holds: "erasure scope, status, hold reasons, counts",
    retained: "proof of erasure",
  },

  // Regulated financial domain (fin)
  {
    table: "fin.credit_applications",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "request, declared figures, masked PAN, keyed PAN fingerprint",
    erasedBy: ["financial_inputs"],
    purge: "inputs erased when a check expires (90 days unsent)",
  },
  {
    table: "fin.bureau_summaries",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "score band and tradeline counts (never the report)",
    erasedBy: ["financial_inputs"],
  },
  {
    table: "fin.cashflow_sessions",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "AA session, mobile last 4 + fingerprint",
    erasedBy: ["financial_inputs"],
  },
  {
    table: "fin.cashflow_accounts",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "masked account numbers, institution, type",
    erasedBy: ["financial_inputs"],
    purge: "line items at AA data-life end (purge_expired_fi_data)",
  },
  {
    table: "fin.cashflow_account_months",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "monthly inflow/outflow/creator income per account",
    erasedBy: ["financial_inputs"],
  },
  {
    table: "fin.cashflow_months",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "monthly totals across accounts",
    erasedBy: ["financial_inputs"],
  },
  {
    table: "fin.fi_transactions",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "AA line items, narration/counterparty sealed (AES-256-GCM)",
    erasedBy: ["financial_inputs"],
    purge: "at AA data-life end (purge_expired_fi_data)",
  },
  {
    table: "fin.fi_vendor_analytics",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "vendor analytics payload, sealed",
    erasedBy: ["financial_inputs"],
    purge: "at AA data-life end (purge_expired_fi_data)",
  },
  {
    table: "fin.financial_feature_runs",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "Financial Capacity run metadata",
    erasedBy: ["financial_inputs"],
  },
  {
    table: "fin.financial_features",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "Financial Capacity features",
    erasedBy: ["financial_inputs"],
  },
  {
    table: "fin.underwriting_runs",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "run metadata, model version, input hashes",
    erasedBy: ["financial_inputs", "identity_lookup", "social_account_data", "professional_graph"],
  },
  {
    table: "fin.underwriting_inputs",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "frozen feature values per run",
    erasedBy: ["financial_inputs", "identity_lookup", "social_account_data", "professional_graph"],
  },
  {
    table: "fin.underwriting_results",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "scores, grades, recommendations, reason codes",
    erasedBy: ["financial_inputs", "identity_lookup", "social_account_data", "professional_graph"],
  },
  {
    table: "fin.fraud_checks",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "fraud rule inputs and results",
    erasedBy: ["financial_inputs", "identity_lookup", "social_account_data", "professional_graph"],
  },
  {
    table: "fin.fraud_flags",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "fraud flags with evidence",
    erasedBy: ["financial_inputs", "identity_lookup", "social_account_data", "professional_graph"],
  },
  {
    table: "fin.credit_proposals",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "frozen proposal payload sent to a lender",
    erasedBy: ["financial_inputs"],
    retained: "held while the lender relationship is open (retention hold)",
  },
  {
    table: "fin.lender_decisions",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "lender outcome, exposure, terms",
    erasedBy: ["financial_inputs"],
    retained: "held while the lender relationship is open",
  },
  {
    table: "fin.decision_reviews",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "staff confirm/override with reason",
    erasedBy: ["financial_inputs"],
    retained: "held while the lender relationship is open",
  },
  {
    table: "fin.decision_queries",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "staff queries to the lender",
    erasedBy: ["financial_inputs"],
    retained: "held while the lender relationship is open",
  },
  {
    table: "fin.offer_responses",
    domain: "regulated_financial",
    sensitivity: "restricted",
    personal: true,
    holds: "accept/decline, terms hash, KFS acknowledgement",
    erasedBy: ["financial_inputs"],
    retained: "held while the lender relationship is open",
  },

  // Analytics
  {
    table: "analytics.events",
    domain: "analytics",
    sensitivity: "confidential",
    personal: true,
    holds: "event, keyed pseudonym, enum props (incl. reviewed sign-up campaign tags), India-time day",
    erasedBy: ["product_analytics_events", "financial_funnel_events"],
    purge: "after 24 months, once rolled up (analytics_maintenance)",
  },
  {
    table: "analytics.daily_counts",
    domain: "analytics",
    sensitivity: "internal",
    personal: false,
    holds: "daily event and subject counts (no ids)",
  },

  // Audit and provider metadata
  {
    table: "public.audit_events",
    domain: "audit",
    sensitivity: "confidential",
    personal: true,
    holds: "actor and entity ids, event type, small scalar metadata",
    retained: "append-only audit trail (period: counsel/RE)",
  },
  {
    table: "public.provider_requests",
    domain: "audit",
    sensitivity: "internal",
    personal: true,
    holds: "provider call metadata (no payloads)",
    retained: "audit of third-party data access (period: counsel/RE)",
  },

  // Control plane (ops)
  {
    table: "ops.provider_configs",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "adapter settings, env var names (no secrets)",
  },
  {
    table: "ops.provider_routes",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "routing, kill switch",
  },
  {
    table: "ops.feature_switches",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "feature switches (e.g. brand payment matching), maker-checker",
  },
  {
    table: "ops.provider_runtime",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "circuit breaker and health state",
  },
  {
    table: "ops.provider_call_stats",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "call counts and durations",
  },
  {
    table: "ops.integration_change_requests",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "maker-checker changes (staff ids)",
  },
  {
    table: "ops.jobs",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "job queue (ids and counts only)",
  },
  {
    table: "ops.simulated_lender_policies",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "simulated lender policy versions",
  },
  {
    table: "ops.partners",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "partner lenders and environments",
  },
  {
    table: "ops.partner_api_keys",
    domain: "control_plane",
    sensitivity: "restricted",
    personal: false,
    holds: "API key SHA-256 hashes and prefixes",
  },
  {
    table: "ops.partner_webhook_endpoints",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "webhook URLs, secret versions (no secrets)",
  },
  {
    table: "ops.partner_events",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "event feed (ids only)",
  },
  {
    table: "ops.partner_webhook_deliveries",
    domain: "control_plane",
    sensitivity: "internal",
    personal: false,
    holds: "delivery attempts (ids, HTTP status)",
  },
  {
    table: "ops.rate_limit_counters",
    domain: "control_plane",
    sensitivity: "confidential",
    personal: true,
    holds: "keyed hash of IP/user/partner, window counts",
    purge: "after 48 hours (rate_limit_purge)",
  },

  // Reference
  {
    table: "public.creator_categories",
    domain: "reference",
    sensitivity: "public",
    personal: false,
    holds: "category vocabulary",
  },
  {
    table: "public.social_platforms",
    domain: "reference",
    sensitivity: "public",
    personal: false,
    holds: "platform vocabulary",
  },
];

const SENSITIVITY_ORDER: Record<Sensitivity, number> = { restricted: 0, confidential: 1, internal: 2, public: 3 };

/** How the table's data leaves the system, in one line. */
export function lifecycleOf(entry: TableEntry): string {
  const parts: string[] = [];
  if (entry.erasedBy?.length) parts.push(`erased on withdrawal: ${entry.erasedBy.join(", ")}`);
  if (entry.purge) parts.push(`purged ${entry.purge}`);
  if (entry.retained) parts.push(entry.retained);
  return parts.join("; ") || "no personal data";
}

/** The markdown table embedded in docs/DATA_CLASSIFICATION.md (kept in sync by a test). */
export function renderDataInventory(entries: readonly TableEntry[] = DATA_INVENTORY): string {
  const rows = [...entries]
    .sort(
      (a, b) => SENSITIVITY_ORDER[a.sensitivity] - SENSITIVITY_ORDER[b.sensitivity] || a.table.localeCompare(b.table),
    )
    .map(
      (e) =>
        `| \`${e.table}\` | ${e.sensitivity} | ${e.domain.replace(/_/g, " ")} | ${e.personal ? "yes" : "no"} | ${e.holds} | ${lifecycleOf(e)} |`,
    );
  return [
    "| Table | Sensitivity | Domain | Personal | Holds | Lifecycle |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
