import type {
  BankAccountType,
  BureauScoreBand,
  CashflowCoverage,
  FinancePurpose,
  IncomeSource,
  MissingAccountReason,
  SharedAccountStatus,
} from "./domain";
import type { FinFeatureKey } from "./financial-features";

/**
 * Creator-facing copy for the eligibility check (pure; safe in native apps).
 * Describes inputs — never an approval, limit or "score you deserve".
 */
export const PURPOSE_LABELS: Record<FinancePurpose, string> = {
  equipment: "Camera and tech gear",
  content_production: "Producing content",
  studio_setup: "Studio or workspace",
  team_hiring: "Editors or team",
  work_travel: "Travel for shoots or events",
  marketing: "Growing my channel or brand",
  working_capital: "Bridging delayed brand payments",
  education: "Courses and upskilling",
  other: "Something else",
};

/** "Camera and tech gear, Studio or workspace" — the note is shown separately. */
export function purposesSummary(purposes: readonly string[]): string {
  return purposes.map((p) => PURPOSE_LABELS[p as FinancePurpose] ?? p).join(", ");
}

export const ACCOUNT_STATUS_LABELS: Record<SharedAccountStatus, string> = {
  delivered: "Shared",
  pending: "Waiting for your bank",
  timeout: "Your bank didn't respond",
  denied: "Your bank declined",
  failed: "Couldn't be fetched",
};

export const ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  savings: "Savings",
  current: "Current",
  overdraft: "Overdraft",
  other: "Account",
};

export const COVERAGE_LABELS: Record<CashflowCoverage, string> = {
  complete: "Every account with creator income",
  partial: "Some of your accounts",
  none: "No accounts",
};

export const MISSING_REASON_LABELS: Record<MissingAccountReason, string> = {
  other_number_unavailable: "They're linked to a number I can't use right now",
  bank_not_on_aa: "My bank isn't on the Account Aggregator network",
  chose_not_to_share: "I'd rather not share them",
};

export const INCOME_SOURCE_LABELS: Record<IncomeSource, string> = {
  brand_deals: "Brand deals",
  platform_payouts: "Platform payouts",
  affiliate: "Affiliate commissions",
  services: "Services or freelance",
  products: "My own products",
  other: "Other",
};

export const BUREAU_BAND_LABELS: Record<BureauScoreBand, string> = {
  no_hit: "No credit history found",
  thin: "Limited credit history",
  low: "Developing",
  medium: "Fair",
  high: "Strong",
};

export const FIN_FEATURE_COPY: Record<FinFeatureKey, { label: string; group: "credit" | "cashflow" | "declared" }> = {
  bureau_score_band: { label: "Credit history", group: "credit" },
  active_credit_accounts: { label: "Active credit accounts", group: "credit" },
  delinquencies_12m: { label: "Missed payments (12 months)", group: "credit" },
  credit_enquiries_6m: { label: "Recent credit enquiries (6 months)", group: "credit" },
  avg_monthly_inflow_6m: { label: "Average money in each month", group: "cashflow" },
  inflow_volatility_6m: { label: "Month-to-month variation", group: "cashflow" },
  avg_monthly_creator_income_6m: { label: "Average creator income each month", group: "cashflow" },
  creator_income_share_6m: { label: "Share of money in from creator work", group: "cashflow" },
  creator_income_months_12m: { label: "Months with creator income", group: "cashflow" },
  avg_monthly_net_cashflow_6m: { label: "Average left over each month", group: "cashflow" },
  declared_monthly_income: { label: "Monthly income you told us", group: "declared" },
  declared_to_observed_income: { label: "Told vs seen in bank data", group: "declared" },
  declared_monthly_emi: { label: "Existing EMIs you told us", group: "declared" },
  emi_to_income: { label: "EMIs as a share of verified income", group: "declared" },
  income_source_count: { label: "Income sources", group: "declared" },
  bank_accounts_shared: { label: "Bank accounts shared", group: "cashflow" },
  bank_accounts_not_received: { label: "Accounts not received", group: "cashflow" },
  bank_coverage: { label: "Covers", group: "cashflow" },
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatInr = (n: number) => inr.format(n);

export function formatFinValue(key: FinFeatureKey, value: number | string | null): string {
  if (value === null) return "Not available";
  if (typeof value === "string")
    return key === "bureau_score_band"
      ? (BUREAU_BAND_LABELS[value as BureauScoreBand] ?? value)
      : key === "bank_coverage"
        ? (COVERAGE_LABELS[value as CashflowCoverage] ?? value)
        : value;
  switch (key) {
    case "avg_monthly_inflow_6m":
    case "avg_monthly_creator_income_6m":
    case "avg_monthly_net_cashflow_6m":
    case "declared_monthly_income":
    case "declared_monthly_emi":
      return formatInr(value);
    case "creator_income_share_6m":
    case "creator_income_months_12m":
    case "emi_to_income":
      return `${Math.round(value * 100)}%`;
    case "inflow_volatility_6m":
      return value < 0.15 ? "Steady" : value < 0.35 ? "Some variation" : "Varies a lot";
    case "declared_to_observed_income":
      return value >= 0.8 && value <= 1.25 ? "Matches" : value > 1.25 ? "Higher than seen" : "Lower than seen";
    default:
      return String(value);
  }
}
