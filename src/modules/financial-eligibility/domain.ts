/**
 * Financial-eligibility vocabulary (regulated financial domain).
 *
 * The check is product-agnostic: the creator says what the money is for and
 * roughly how much; the partner bank/NBFC decides the product later.
 */
export const APPLICATION_STATUSES = [
  "draft",
  "inputs_ready",
  /** Sent to a partner lender (Stage 12). Its inputs then follow the lender's retention rules. */
  "submitted",
  "withdrawn",
  "expired",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const OPEN_APPLICATION_STATUSES = ["draft", "inputs_ready"] as const satisfies readonly ApplicationStatus[];

/** What the money is for. A creator picks up to MAX_PURPOSES; `purpose` keeps the first (primary). */
export const FINANCE_PURPOSES = [
  "equipment",
  "content_production",
  "studio_setup",
  "team_hiring",
  "work_travel",
  "marketing",
  "working_capital",
  "education",
  "other",
] as const;
export type FinancePurpose = (typeof FINANCE_PURPOSES)[number];
export const MAX_PURPOSES = 3;
/** Short free-text note when "Something else" is chosen. Never logged or audited. */
export const PURPOSE_NOTE_MAX = 140;

export const INCOME_SOURCES = [
  "brand_deals",
  "platform_payouts",
  "affiliate",
  "services",
  "products",
  "other",
] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];

export const BUREAU_STATUSES = ["not_started", "completed"] as const;
/**
 * Bank-data step, derived from the sharing sessions (Stage 09b):
 * - `completed`: at least one account's data was received;
 * - `pending`: a sharing session is waiting for the creator at the aggregator;
 * - `declined`: the creator rejected sharing and nothing was received;
 * - `unavailable`: sharing was attempted but no data arrived (no accounts found, every account failed) —
 *   never read as "no income";
 * - `skipped`: the creator chose to continue without bank data.
 */
export const CASHFLOW_STATUSES = ["not_started", "pending", "completed", "declined", "unavailable", "skipped"] as const;
export type CashflowStatus = (typeof CASHFLOW_STATUSES)[number];

/** One Account Aggregator journey for one mobile number (plus any number the aggregator verified in-journey). */
export const CASHFLOW_SESSION_STATUSES = [
  "pending",
  /** Data received for every selected account. */
  "completed",
  /** Data received for some selected accounts; others timed out, were denied or failed. */
  "partial",
  "declined",
  /** The aggregator found no accounts linked to the number. */
  "no_accounts",
  "failed",
  /** Replaced by a newer session for the same number before it returned. */
  "abandoned",
] as const;
export type CashflowSessionStatus = (typeof CASHFLOW_SESSION_STATUSES)[number];

/** Per-account outcome reported by the aggregator (FI status). */
export const SHARED_ACCOUNT_STATUSES = ["delivered", "pending", "timeout", "denied", "failed"] as const;
export type SharedAccountStatus = (typeof SHARED_ACCOUNT_STATUSES)[number];
export const BANK_ACCOUNT_TYPES = ["savings", "current", "overdraft", "other"] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

/**
 * How much of the creator's banking the shared data covers:
 * none (nothing received) · partial (something missing, by the creator's answer or the aggregator) · complete.
 */
export const CASHFLOW_COVERAGE = ["none", "partial", "complete"] as const;
export type CashflowCoverage = (typeof CASHFLOW_COVERAGE)[number];
/** Why some accounts aren't shared (creator's answer). */
export const MISSING_ACCOUNT_REASONS = ["other_number_unavailable", "bank_not_on_aa", "chose_not_to_share"] as const;
export type MissingAccountReason = (typeof MISSING_ACCOUNT_REASONS)[number];

/** Mobile numbers a creator can search for accounts in one check (the aggregator may allow fewer). */
export const MAX_MOBILE_NUMBERS = 3;
/** Sharing sessions per check (bounds retries). */
export const MAX_CASHFLOW_SESSIONS = 8;
/** A pending session older than this is shown as not completed (the creator can start again). */
export const CASHFLOW_SESSION_STALE_MS = 30 * 60_000;

export const BUREAU_SCORE_BANDS = ["no_hit", "thin", "low", "medium", "high"] as const;
export type BureauScoreBand = (typeof BUREAU_SCORE_BANDS)[number];

/** Unsent applications expire, and their financial inputs are erased, after this many days (user decision). */
export const APPLICATION_TTL_DAYS = 90;
/** Bureau checks per creator per rolling 30 days. */
export const BUREAU_CHECKS_PER_30_DAYS = 3;
/** Months of bank cashflow requested through the Account Aggregator. */
export const CASHFLOW_MONTHS = 12;
/** Data-life requested in the AA consent: no longer than an unsent check lives. */
export const FI_DATA_LIFE_DAYS = APPLICATION_TTL_DAYS;

export const AMOUNT_LIMITS = { min: 10_000, max: 25_00_000 } as const;
export const MONTHLY_INCOME_MAX = 1_00_00_000;
