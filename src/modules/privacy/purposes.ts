import type { ConsentKey, ErasureScope } from "@/modules/consent/domain";
import { CONSENT_KEYS } from "@/modules/consent/domain";

/**
 * What each consent purpose means and what withdrawing it does. Pure data:
 * shared by the web consent centre, the API and future native apps, and the
 * single place the withdrawal service reads its effects from.
 */
export interface PurposePolicy {
  key: ConsentKey;
  /** Short name used in lists. */
  label: string;
  /** One line on what the purpose covers. */
  summary: string;
  /** The Creator Profile consent: withdrawing it pauses membership. */
  core: boolean;
  /** Creator-facing description of the consequences of withdrawing. */
  onWithdraw: readonly string[];
  /** Data erased on withdrawal (subject to retention holds). */
  erasure: readonly ErasureScope[];
}

export const PURPOSES: readonly PurposePolicy[] = [
  {
    key: CONSENT_KEYS.creatorProfile,
    label: "Creator Professional Profile",
    summary: "Keeping your profile so you can be a CreatorCo member.",
    core: true,
    onWithdraw: [
      "Your membership is paused. Home, Passport and Access close until you give this consent again.",
      "Pending Access requests are cancelled and their Creator Points returned.",
      "We stop processing your profile, connected accounts and signals.",
      "Your details are kept, so you can resume at any time. Closing your account is a separate request.",
    ],
    erasure: [],
  },
  {
    key: CONSENT_KEYS.identityPrefill,
    label: "Identity verification",
    summary: "Fetching your PAN-linked name to verify and prefill your legal name.",
    core: false,
    onWithdraw: [
      "Your verified identity details (verified name and masked PAN) are erased.",
      "Your legal name stays on your profile, marked as self-declared.",
    ],
    erasure: ["identity_lookup"],
  },
  {
    key: CONSENT_KEYS.socialAccountConnection,
    label: "Social account connection",
    summary: "Reading metrics from the accounts you connect, to verify your creator activity.",
    core: false,
    onWithdraw: [
      "Every connected account is disconnected. Platforms you declared stay as self-declared.",
      "Stored monthly metrics from those accounts are erased.",
      "Signals computed from them are erased and, if signals are on, recomputed without them.",
    ],
    erasure: ["social_account_data", "professional_graph"],
  },
  {
    key: CONSENT_KEYS.professionalAnalytics,
    label: "Professional signals",
    summary: "Computing signals about your creator business. Not a credit score.",
    core: false,
    onWithdraw: [
      "We stop computing professional signals.",
      "Signals already computed are erased, along with any CreatorCo recommendation that used them.",
    ],
    erasure: ["professional_graph"],
  },
  {
    key: CONSENT_KEYS.financialEligibility,
    label: "Financial eligibility",
    summary: "Checking your eligibility for creator business finance from partner lenders.",
    core: false,
    onWithdraw: [
      "Any open eligibility check is closed.",
      "Its financial inputs — bureau summary, bank cashflow totals and what you declared — and any recommendation and fraud-check results are erased.",
      "Our pseudonymous measurement of your eligibility steps (for example, that a check was started or an offer shown) is erased too.",
    ],
    erasure: ["financial_inputs", "financial_funnel_events"],
  },
  {
    key: CONSENT_KEYS.lenderSharing,
    label: "Share with a partner lender",
    summary: "Sending your confirmed eligibility checks to a partner lender as a credit proposal.",
    core: false,
    onWithdraw: [
      "Proposals not yet sent to a partner lender are cancelled.",
      "Checks you confirm from now on aren't sent.",
      "A proposal already sent stays with that lender under its legal retention rules.",
    ],
    erasure: [],
  },
  {
    key: CONSENT_KEYS.lenderHandoff,
    label: "Continue with the partner lender",
    summary: "Passing your acceptance and contact details to the partner lender whose offer you accept.",
    core: false,
    onWithdraw: [
      "CreatorCo stops passing your details to partner lenders, including for an accepted offer whose lender hasn't collected them yet.",
      "Details already passed to a partner lender stay with that lender under its legal retention rules.",
    ],
    erasure: [],
  },
  {
    key: CONSENT_KEYS.brandOpportunities,
    label: "Brand opportunities",
    summary: "Considering your requests for brand opportunities in Access.",
    core: false,
    onWithdraw: [
      "Pending Access requests are cancelled and their Creator Points returned.",
      "Your Access request history, including any notes, is erased.",
      "You can't request new opportunities until you give this consent again. Your Creator Points balance stays.",
    ],
    erasure: ["access_requests"],
  },
  {
    key: CONSENT_KEYS.productAnalytics,
    label: "Product analytics",
    summary: "Recording which screens you open, under a pseudonymous ID, to improve CreatorCo. Optional.",
    core: false,
    onWithdraw: [
      "We stop recording which screens you open.",
      "Screen views already recorded are erased. Daily totals with no IDs remain.",
      "Service measurement of key steps (pseudonymous, no personal details) continues while you're a member.",
    ],
    erasure: ["product_analytics_events"],
  },
  {
    key: CONSENT_KEYS.brandWorkRecords,
    label: "Verified brand work",
    summary:
      "Storing your brand-work records and documents, verifying them and using verified ones in your Professional Graph.",
    core: false,
    onWithdraw: [
      "We stop processing your brand-work records straight away.",
      "Your records, documents and their review history are erased.",
      "Creator Points you've already earned stay.",
    ],
    erasure: ["brand_work_records"],
  },
  {
    key: CONSENT_KEYS.brandPaymentMatch,
    label: "Check brand payments in shared bank data",
    summary: "Checking bank data you already shared for a payment matching a verified record. Optional.",
    core: false,
    onWithdraw: [
      "We stop checking your shared bank data for brand payments.",
      "Payments confirmed this way go back to unconfirmed. Other confirmations stay.",
    ],
    erasure: ["brand_payment_matches"],
  },
];

/** Shown wherever erasure is mentioned: credit records follow the partner lender's retention rules. */
export const RETENTION_HOLD_NOTE =
  "If any of this data supports an open application or financial product with a partner lender, we stop using it straight away but erase it only once that relationship is closed and any records the law requires are no longer needed.";

export function purposeFor(key: string): PurposePolicy | null {
  return PURPOSES.find((p) => p.key === key) ?? null;
}

export const WITHDRAWAL_REASON_LABELS = {
  not_using: "I'm not using this",
  privacy: "Privacy concerns",
  too_much_data: "It asks for too much data",
  other: "Something else",
} as const;

/**
 * Essential service measurement (Stage 15, user decision): shown in the consent centre and to be carried into the
 * privacy notice (counsel item). Not a consent — a disclosure.
 */
export const SERVICE_MEASUREMENT_NOTE =
  "To run and improve the service, CreatorCo counts key steps — such as completing your profile, connecting an account, starting an eligibility check or answering an offer — under a pseudonymous ID, recording only the day. When you join, it also notes the campaign tag on the link you arrived from and the kind of site that sent you (search, social or other), kept in a cookie for up to a day until you sign up. These records never include your name, contact details, PAN, notes, terms, amounts, scores or reasons for a decision. Steps about eligibility checks and offers are erased if you withdraw your financial-eligibility consent; everything else is kept for at most 24 months.";
