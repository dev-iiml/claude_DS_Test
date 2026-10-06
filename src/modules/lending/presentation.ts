import type { OfferTerms } from "@/providers/lender/offer";

import type { DecisionOutcome, OfferDeclineReason, OfferState, ProposalStatus } from "./domain";

/** Copy for lender decisions and proposals (pure; safe in native apps). Never "CreatorCo approved". */
export const DECISION_LABELS: Record<DecisionOutcome, string> = {
  approved: "Approved",
  modified: "Approved with changes",
  declined: "Not approved",
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  held: "Held for review",
  queued: "Queued",
  sending: "Sending",
  submitted: "With the lender",
  decided: "Decision received",
  failed: "Failed to send",
  withdrawn: "Withdrawn",
};

export const LENDER_REASON_LABELS: Record<string, string> = {
  RE_MODEL_RESULT_MISSING: "No result for the decision model",
  RE_NOT_RECOMMENDED: "CreatorCo didn't recommend",
  RE_NO_RECOMMENDED_AMOUNT: "No recommended amount (e.g. no verified income)",
  RE_REFERRED_CASE: "Referred case, decided on the recommended amount after CreatorCo's review",
  RE_POLICY_GRADE: "Grade below policy",
  RE_POLICY_DATA_COMPLETENESS: "Too little data",
  RE_POLICY_DELINQUENCY: "Recent missed payments",
  RE_POLICY_BANK_COVERAGE: "Bank coverage below policy",
  RE_POLICY_EXPOSURE_CAP: "Capped at the policy maximum",
  RE_POLICY_TENOR_CAP: "Tenor capped at the policy maximum",
};

// ── Offers (Stage 13) ─────────────────────────────────────────────────────

export const OFFER_STATE_LABELS: Record<OfferState, string> = {
  open: "Offer ready",
  accepted: "Offer accepted",
  declined: "Offer declined",
  expired: "Offer expired",
};

export const OFFER_DECLINE_REASON_LABELS: Record<OfferDeclineReason, string> = {
  no_longer_needed: "I don't need it any more",
  terms: "The terms don't suit me",
  other_lender: "I'm going with another lender",
  other: "Something else",
};

const inr = (n: number) => `₹${new Intl.NumberFormat("en-IN").format(n)}`;
const pct = (n: number) => `${n.toFixed(2).replace(/\.00$/, "")}%`;

/** The Key Fact Statement rows, in the order a creator reads them. Values are the lender's, as given. */
export function kfsRows(t: OfferTerms): { label: string; value: string }[] {
  return [
    { label: "Lender", value: t.lenderName },
    { label: "Amount sanctioned", value: inr(t.sanctionedAmount) },
    { label: "Tenor", value: `${t.tenorMonths} months` },
    { label: "Interest rate", value: `${pct(t.annualInterestRatePct)} a year, ${t.interestRateType}` },
    { label: "Processing fee", value: inr(t.processingFee) },
    ...t.otherCharges.map((c) => ({ label: c.label, value: inr(c.amount) })),
    { label: "Annual Percentage Rate (APR)", value: pct(t.aprPct) },
    { label: "Monthly instalment (EMI)", value: `${inr(t.emiAmount)} × ${t.emiCount}` },
    { label: "Total interest", value: inr(t.totalInterest) },
    { label: "Total you repay", value: inr(t.totalRepayable) },
    { label: "Cooling-off period", value: `${t.coolingOffDays} days after you sign` },
    {
      label: "Grievance officer",
      value: [t.grievanceOfficer.name, t.grievanceOfficer.email, t.grievanceOfficer.phone].filter(Boolean).join(" · "),
    },
    { label: "KFS reference", value: t.kfsReference },
  ];
}
