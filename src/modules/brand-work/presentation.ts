import {
  BRAND_INDUSTRIES,
  type ConfirmationMethod,
  type DeliverableType,
  type DocumentKind,
  type PaymentStatus,
  type VerificationStatus,
} from "./domain";

/** Creator-facing copy for verified brand work (pure). No credit, loan or "approved" language. */

export const VERIFICATION_STATUS_COPY: Record<
  VerificationStatus,
  { label: string; tone: "neutral" | "info" | "warning" | "success" | "brand"; detail: string }
> = {
  draft: { label: "Draft", tone: "neutral", detail: "Add your documents, then send it for verification." },
  submitted: {
    label: "Checking files",
    tone: "info",
    detail: "We're checking your files before a reviewer opens them.",
  },
  in_review: {
    label: "In review",
    tone: "info",
    detail: "A CreatorCo reviewer is checking it against your documents.",
  },
  needs_info: { label: "Needs a change", tone: "warning", detail: "Update the record or documents and send it again." },
  verified: { label: "Verified", tone: "success", detail: "Checked against your documents by CreatorCo." },
  rejected: { label: "Not verified", tone: "neutral", detail: "We couldn't verify this record." },
};

export const PAYMENT_STATUS_COPY: Record<PaymentStatus, string> = {
  unconfirmed: "Not confirmed yet",
  confirmed: "Confirmed",
  not_seen: "Not found in your shared bank data",
};

export const CONFIRMATION_METHOD_COPY: Record<ConfirmationMethod, { label: string; detail: string }> = {
  agency_confirmation: {
    label: "My agency can confirm",
    detail: "A CreatorCo reviewer checks with the agency or brand team that billed it.",
  },
  remittance_advice: {
    label: "Upload remittance advice",
    detail: "The payment advice the brand or agency sent you. A reviewer checks it.",
  },
  aa_match: {
    label: "Check my shared bank data",
    detail:
      "Looks for the payment in bank data you already shared for an eligibility check. Only “seen” and the month are recorded.",
  },
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  invoice: "Invoice",
  purchase_order: "Purchase order",
  agreement: "Agreement or contract",
  remittance_advice: "Remittance advice",
};

export const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  reel: "Reel",
  story: "Story",
  post: "Post",
  integrated_video: "Integrated video",
  dedicated_video: "Dedicated video",
  livestream: "Livestream",
  event: "Event",
  ugc: "UGC",
};

export const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  snapchat: "Snapchat",
  moj: "Moj",
  josh: "Josh",
  other: "Other",
};

export const BILLED_PARTY_LABELS = {
  brand: "The brand directly",
  agency: "An agency",
  platform: "A platform or marketplace",
} as const;

export const INDUSTRY_LABELS: Record<string, string> = Object.fromEntries(BRAND_INDUSTRIES);

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatPaise = (paise: number | null) => (paise === null ? "—" : inr.format(paise / 100));

const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
export const formatMonth = (ym: string) => monthFmt.format(new Date(`${ym.slice(0, 7)}-01T00:00:00Z`));
