import { z } from "zod";

/**
 * Offer terms (Stage 13) — what the partner lender offers after approving a
 * credit proposal, including its Key Fact Statement (KFS). The partner lender
 * (the regulated entity) produces these; CreatorCo shows them as provided and
 * never computes a real lender's terms. The pilot's simulated lender
 * generates ILLUSTRATIVE terms (`illustrativeOffer`), clearly labelled.
 *
 * Pure (no Node/DOM APIs), shared by the partner API, the lending module and
 * the UI. Amounts are whole rupees; rates are percentages per year.
 */
export const OFFER_TERMS_VERSION = "kfs-1";
export const MIN_COOLING_OFF_DAYS = 3;

const rupees = z.number().int().min(0).max(1_00_00_000);
const pct = z.number().min(0).max(100);

export const offerTermsSchema = z
  .object({
    /** The lender making the offer, as it should be shown to the creator. */
    lenderName: z.string().trim().min(2).max(80),
    sanctionedAmount: rupees,
    tenorMonths: z.number().int().min(1).max(120),
    interestRateType: z.enum(["fixed", "floating"]),
    annualInterestRatePct: pct,
    processingFee: rupees,
    otherCharges: z
      .array(z.object({ label: z.string().trim().min(2).max(60), amount: rupees }).strict())
      .max(10)
      .default([]),
    /** Annual Percentage Rate: the all-in annual cost, as computed by the lender. */
    aprPct: pct,
    emiAmount: rupees,
    emiCount: z.number().int().min(1).max(120),
    totalInterest: rupees,
    /** Everything the creator repays: principal, interest and charges. */
    totalRepayable: rupees,
    /**
     * Days after signing during which the borrower can exit by repaying principal and proportionate APR.
     * At least 3 days, as the RBI digital lending rules require for loans of 7 days or more — to confirm
     * with counsel and the partner.
     */
    coolingOffDays: z.number().int().min(MIN_COOLING_OFF_DAYS).max(60),
    grievanceOfficer: z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.email().max(120),
        phone: z
          .string()
          .regex(/^\+?[0-9 -]{8,20}$/)
          .optional(),
      })
      .strict(),
    /** The lender's own identifier for its KFS document/version. */
    kfsReference: z.string().regex(/^[A-Za-z0-9_.:/-]{3,80}$/),
    termsUrl: z
      .url()
      .max(300)
      .refine((u) => u.startsWith("https://"), "Use an https URL.")
      .optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.emiCount > t.tenorMonths)
      ctx.addIssue({ code: "custom", path: ["emiCount"], message: "More instalments than months in the tenor." });
    if (t.totalRepayable < t.sanctionedAmount)
      ctx.addIssue({ code: "custom", path: ["totalRepayable"], message: "Less than the amount sanctioned." });
    if (t.aprPct + 0.005 < t.annualInterestRatePct)
      ctx.addIssue({ code: "custom", path: ["aprPct"], message: "The APR can't be below the interest rate." });
    // The KFS must add up: a statement that contradicts itself is never shown to a creator as fact.
    const charges = t.processingFee + t.otherCharges.reduce((sum, c) => sum + c.amount, 0);
    const payments = t.emiAmount * t.emiCount;
    const tolerance = t.emiCount; // ±₹1 per instalment for rounding
    if (Math.abs(t.totalRepayable - (payments + charges)) > tolerance)
      ctx.addIssue({
        code: "custom",
        path: ["totalRepayable"],
        message: "Must equal the instalments plus every charge.",
      });
    if (Math.abs(t.totalInterest - (payments - t.sanctionedAmount)) > tolerance)
      ctx.addIssue({ code: "custom", path: ["totalInterest"], message: "Must equal the instalments less the amount." });
    if (t.emiCount === t.tenorMonths && t.sanctionedAmount > charges) {
      const effective = apr(t.sanctionedAmount - charges, t.emiAmount, t.emiCount);
      if (t.aprPct + 0.01 < effective)
        ctx.addIssue({
          code: "custom",
          path: ["aprPct"],
          message: `The APR understates the all-in cost (at least ${effective}% from the instalments and charges).`,
        });
    }
  });
export type OfferTerms = z.output<typeof offerTermsSchema>;

/** A lender's offer: the terms and how long they stand. */
export interface Offer {
  terms: OfferTerms;
  expiresAt: Date;
}

/** Canonical JSON of terms (sorted keys) — what the creator agrees to is hashed from this. */
export function canonicalTerms(terms: OfferTerms): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(terms));
}

// ── Illustrative terms (simulated lender only) ─────────────────────────────

/** Reducing-balance EMI, rounded up to the rupee. */
export function emi(principal: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 1200;
  if (r === 0) return Math.ceil(principal / months);
  const f = (1 + r) ** months;
  return Math.ceil((principal * r * f) / (f - 1));
}

/**
 * APR: the annualised internal rate of return of the amount actually received
 * (principal minus upfront charges) against the EMIs. Bisection, monthly
 * compounding × 12, two decimals.
 */
export function apr(netDisbursed: number, instalment: number, months: number): number {
  if (netDisbursed <= 0 || instalment * months <= netDisbursed) return 0;
  const pv = (r: number) => (r === 0 ? instalment * months : (instalment * (1 - (1 + r) ** -months)) / r);
  let lo = 0;
  let hi = 1; // 100% a month
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > netDisbursed) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1200 * 100) / 100;
}

export interface IllustrativeOfferInput {
  lenderName: string;
  amount: number;
  tenorMonths: number;
  annualInterestRatePct: number;
  processingFeePct: number;
  coolingOffDays: number;
  kfsReference: string;
}

/** Terms the SIMULATED lender shows (never a real lender's). */
export function illustrativeOffer(input: IllustrativeOfferInput): OfferTerms {
  const instalment = emi(input.amount, input.annualInterestRatePct, input.tenorMonths);
  const totalPayments = instalment * input.tenorMonths;
  const fee = Math.round((input.amount * input.processingFeePct) / 100);
  return {
    lenderName: input.lenderName,
    sanctionedAmount: input.amount,
    tenorMonths: input.tenorMonths,
    interestRateType: "fixed",
    annualInterestRatePct: input.annualInterestRatePct,
    processingFee: fee,
    otherCharges: [],
    aprPct: Math.max(apr(input.amount - fee, instalment, input.tenorMonths), input.annualInterestRatePct),
    emiAmount: instalment,
    emiCount: input.tenorMonths,
    totalInterest: totalPayments - input.amount,
    totalRepayable: totalPayments + fee,
    coolingOffDays: input.coolingOffDays,
    grievanceOfficer: { name: "Simulated pilot (no real lender)", email: "pilot-grievance@creatorco.test" },
    kfsReference: input.kfsReference,
  };
}

/**
 * The same terms re-priced for a different amount/tenor (a simulated-lender
 * override, never more favourable): keeps the rate and the fee percentage.
 */
export function repriceIllustrative(terms: OfferTerms, amount: number, tenorMonths: number): OfferTerms {
  const feePct = terms.sanctionedAmount > 0 ? (terms.processingFee / terms.sanctionedAmount) * 100 : 0;
  return illustrativeOffer({
    lenderName: terms.lenderName,
    amount,
    tenorMonths,
    annualInterestRatePct: terms.annualInterestRatePct,
    processingFeePct: feePct,
    coolingOffDays: terms.coolingOffDays,
    kfsReference: terms.kfsReference,
  });
}
