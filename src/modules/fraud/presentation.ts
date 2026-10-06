import type { FraudCheckCode, FraudOutcome, FraudSeverity } from "./rules";

/** Staff-facing labels for fraud results (pure; never shown to creators). */

export const FRAUD_CHECK_LABELS: Record<FraudCheckCode, { title: string; detail: string }> = {
  IDENTITY_NAME_MISMATCH: {
    title: "Name differs from identity lookup",
    detail: "Declared legal name vs the name returned for the verified mobile.",
  },
  DUPLICATE_PAN_ACCOUNTS: {
    title: "Same PAN on another account",
    detail: "Another CreatorCo account has an open or sent check with this PAN.",
  },
  PAN_CHANGED_ACROSS_CHECKS: {
    title: "PAN changed between checks",
    detail: "This creator's other checks used a different PAN.",
  },
  DECLARED_INCOME_INCONSISTENT: {
    title: "Declared income above bank data",
    detail: "Declared monthly income vs creator income observed via the Account Aggregator.",
  },
  CONNECTED_HANDLE_MISMATCH: {
    title: "Connected handle differs from declared",
    detail: "The account connected for a platform isn't the handle the creator declared.",
  },
  DECLARED_TENURE_UNSUPPORTED: {
    title: "Declared tenure longer than connected accounts",
    detail: "“Creator since” is well before the oldest connected account was created.",
  },
  SUSPICIOUS_FOLLOWER_SPIKE: {
    title: "Sudden follower spike",
    detail: "A month-over-month audience jump above 50% (Professional Graph).",
  },
  ANOMALOUS_ENGAGEMENT: {
    title: "Unusual engagement level",
    detail: "Engagement implausibly high or low for the audience size.",
  },
  APPLICATION_VELOCITY: {
    title: "Several checks in 90 days",
    detail: "Three or more eligibility checks started recently.",
  },
};

export const FRAUD_OUTCOME_LABELS: Record<FraudOutcome, string> = {
  clear: "No flags",
  watch: "Flags to note",
  review: "Needs review",
};

export const FRAUD_OUTCOME_TONE: Record<FraudOutcome, "success" | "warning" | "danger"> = {
  clear: "success",
  watch: "warning",
  review: "danger",
};

export const FRAUD_SEVERITY_TONE: Record<FraudSeverity, "neutral" | "warning" | "danger"> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
};

/** Evidence as a short string, e.g. "name_match 0.3 · other_accounts 1". */
export function formatEvidence(evidence: Record<string, number | boolean | null>): string {
  return Object.entries(evidence)
    .map(
      ([k, v]) =>
        `${k.replace(/_/g, " ")} ${v === null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(3)))) : v ? "yes" : "no"}`,
    )
    .join(" · ");
}
