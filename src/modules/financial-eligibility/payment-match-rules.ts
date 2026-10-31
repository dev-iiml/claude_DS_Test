import type { BrandPaymentMatchResult } from "./payment-match-types";

/**
 * Brand payment match rules — pure and versioned. Run ONLY inside
 * `modules/financial-eligibility` over AA data CreatorCo already holds; the
 * result that leaves `fin` is an enum and a month, nothing else.
 */
export const PAYMENT_MATCH_RULES_VERSION = "pm-0.2.0";

export const PAYMENT_MATCH_SETTINGS = {
  windowDaysBefore: 7,
  windowDaysAfter: 120,
  /** Net of plausible TDS: 85–100% of the invoice amount. */
  minShare: 0.85,
  maxShare: 1.0,
} as const;

export type PaymentMatchResult = BrandPaymentMatchResult;

export interface MatchCredit {
  bookedOn: string; // YYYY-MM-DD
  amountPaise: number;
  /** Decrypted counterparty/narration text, used in memory only. */
  payerText: string;
}

const DAY = 86_400_000;

/** Words that never identify a payer on their own (legal forms, payment rails, generic business words). */
const STOP_WORDS = new Set([
  "the",
  "and",
  "private",
  "limited",
  "india",
  "media",
  "digital",
  "studio",
  "studios",
  "group",
  "agency",
  "creative",
  "creatives",
  "ventures",
  "services",
  "solutions",
  "global",
  "brand",
  "brands",
  "collab",
  "campaign",
  "payout",
  "payment",
  "transfer",
  "neft",
  "imps",
  "rtgs",
  "llp",
  "pvt",
  "ltd",
]);
export const payerTokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOP_WORDS.has(t)),
  );

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * `seen` when a credit is in the window, within the TDS band and shares a
 * distinctive word with the billed party's name. `not_seen` only when the
 * shared data covers the whole window (so a payment there would have shown);
 * anything less — no data, a gap, a window that hasn't closed yet — is
 * `unknown`.
 */
export function matchPayment(input: {
  invoiceDate: string;
  expectedAmountPaise: number;
  /** The billed party (who pays the creator). */
  payerName: string;
  credits: MatchCredit[] | null;
  /** First and last day the shared statements cover (across accounts), or null. */
  coverage: { from: string; to: string } | null;
}): { result: PaymentMatchResult; month: string | null } {
  if (input.credits === null) return { result: "unknown", month: null };
  const s = PAYMENT_MATCH_SETTINGS;
  const t0 = dayOf(input.invoiceDate);
  const from = t0 - s.windowDaysBefore * DAY;
  const to = t0 + s.windowDaysAfter * DAY;
  const lo = Math.floor(input.expectedAmountPaise * s.minShare);
  const hi = Math.ceil(input.expectedAmountPaise * s.maxShare);
  const hint = payerTokens(input.payerName);
  if (hint.size === 0) return { result: "unknown", month: null };
  const hit = input.credits
    .filter((c) => {
      const t = dayOf(c.bookedOn);
      if (t < from || t > to || c.amountPaise < lo || c.amountPaise > hi) return false;
      const payer = payerTokens(c.payerText);
      return [...hint].some((h) => payer.has(h));
    })
    .sort((a, b) => a.bookedOn.localeCompare(b.bookedOn))[0];
  if (hit) return { result: "seen", month: `${hit.bookedOn.slice(0, 7)}-01` };
  const covered = input.coverage !== null && dayOf(input.coverage.from) <= from && dayOf(input.coverage.to) >= to;
  return covered ? { result: "not_seen", month: null } : { result: "unknown", month: null };
}
