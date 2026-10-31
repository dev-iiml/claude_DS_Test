import type { AllowedMimeType, BilledPartyType } from "./domain";

/**
 * Brand-work rules — pure and versioned. Record checks produce FLAGS, never
 * scores; a flagged record needs a second reviewer to verify. Any change bumps
 * BRAND_WORK_RULES_VERSION.
 */
export const BRAND_WORK_RULES_VERSION = "bw-0.1.0";

export const BRAND_WORK_FLAGS = [
  "future_dated_invoice",
  "invoice_before_work",
  "duplicate_document",
  "amount_out_of_band",
  "counterparty_mismatch",
  "amount_above_creator_median",
  "many_new_brands_fast",
  "same_brand_amount_month_across_creators",
] as const;
export type BrandWorkFlag = (typeof BRAND_WORK_FLAGS)[number];

export const BRAND_WORK_FLAG_LABELS: Record<BrandWorkFlag, string> = {
  future_dated_invoice: "Invoice dated in the future",
  invoice_before_work: "Invoice dated before the work",
  duplicate_document: "Same document on another creator's record",
  amount_out_of_band: "Amount outside the plausible band",
  counterparty_mismatch: "Billed party differs across documents",
  amount_above_creator_median: "Amount over 5× this creator's verified median",
  many_new_brands_fast: "Many first-time brands verified in a short window",
  same_brand_amount_month_across_creators: "Same brand, amount and month on another creator's record",
};

/** Configurable bands (paise). Hypotheses to tune with reviewers; never a credit input. */
export const RULE_SETTINGS = {
  /** ₹500 – ₹50,00,000 per record. */
  minPlausiblePaise: 500_00,
  maxPlausiblePaise: 50_00_000_00,
  medianMultiple: 5,
  /** At least this many verified records before the median rule applies. */
  medianMinRecords: 3,
  newBrandsWindowDays: 30,
  newBrandsThreshold: 5,
} as const;

export interface RecordCheckInput {
  today: string; // YYYY-MM-DD (India date)
  workDate: string | null;
  invoiceDate: string | null;
  amountPaise: number | null;
  /** Billed-party names the reviewer read off each document (optional; compared normalised). */
  documentCounterparties: string[];
  /** Same document hash already on a different creator's record. */
  duplicateAcrossCreators: boolean;
  /** This creator's verified invoice amounts (for the median rule). */
  creatorVerifiedAmounts: number[];
  /** First-time brands this creator had verified in the last `newBrandsWindowDays`. */
  recentNewBrandCount: number;
  /** Another creator has a record with the same directory brand + amount + work month. */
  sameBrandAmountMonthElsewhere: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function recordFlags(i: RecordCheckInput): BrandWorkFlag[] {
  const flags: BrandWorkFlag[] = [];
  if (i.invoiceDate && i.invoiceDate > i.today) flags.push("future_dated_invoice");
  if (i.invoiceDate && i.workDate && i.invoiceDate < i.workDate) flags.push("invoice_before_work");
  if (i.duplicateAcrossCreators) flags.push("duplicate_document");
  if (
    i.amountPaise !== null &&
    (i.amountPaise < RULE_SETTINGS.minPlausiblePaise || i.amountPaise > RULE_SETTINGS.maxPlausiblePaise)
  )
    flags.push("amount_out_of_band");
  const names = new Set(i.documentCounterparties.map(normaliseBrandName).filter(Boolean));
  if (names.size > 1) flags.push("counterparty_mismatch");
  if (
    i.amountPaise !== null &&
    i.creatorVerifiedAmounts.length >= RULE_SETTINGS.medianMinRecords &&
    i.amountPaise > RULE_SETTINGS.medianMultiple * median(i.creatorVerifiedAmounts)
  )
    flags.push("amount_above_creator_median");
  if (i.recentNewBrandCount >= RULE_SETTINGS.newBrandsThreshold) flags.push("many_new_brands_fast");
  if (i.sameBrandAmountMonthElsewhere) flags.push("same_brand_amount_month_across_creators");
  return flags;
}

/** Flags route to a second reviewer; they never reject on their own. */
export const needsSecondReview = (flags: readonly string[]) => flags.length > 0;

// ── Brand names ─────────────────────────────────────────────────────────────

const LEGAL_SUFFIXES = [
  "private limited",
  "pvt ltd",
  "pvt",
  "limited",
  "ltd",
  "llp",
  "inc",
  "co",
  "company",
  "india",
  "technologies",
  "technology",
];

/** "Nykaa Fashion Pvt. Ltd." → "nykaa fashion". Case, punctuation and legal suffixes removed. */
export function normaliseBrandName(name: string): string {
  let s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (s.endsWith(` ${suffix}`)) {
        s = s.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  // Fits the directory's alias format (≤ 80 characters) whatever the input.
  return s.slice(0, 80).trim();
}

// ── Uploads ─────────────────────────────────────────────────────────────────

/** The type the bytes actually are (magic numbers), or null. The declared MIME type must agree. */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) return "application/pdf";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a)
    return "image/png";
  return null;
}

/** Agency-mediated deals still credit the real brand; the billed party is recorded separately. */
export const isAgencyMediated = (t: BilledPartyType) => t !== "brand";
