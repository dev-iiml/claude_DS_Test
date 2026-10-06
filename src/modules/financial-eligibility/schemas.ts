import { z } from "zod";

import {
  AMOUNT_LIMITS,
  FINANCE_PURPOSES,
  INCOME_SOURCES,
  MAX_PURPOSES,
  MISSING_ACCOUNT_REASONS,
  MONTHLY_INCOME_MAX,
  PURPOSE_NOTE_MAX,
} from "./domain";

/** "1,50,000" / "150000" / "₹ 1.5L" is not accepted — digits and separators only. */
const rupees = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .transform((v) => v.replace(/[,\s₹]/g, ""))
    .pipe(
      z
        .string()
        .regex(/^\d{1,9}$/, `Enter ${label} in rupees, using digits only.`)
        .transform(Number)
        .pipe(
          z
            .number()
            .min(min, `${label[0]!.toUpperCase()}${label.slice(1)} must be at least ₹${min.toLocaleString("en-IN")}.`)
            .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} must be at most ₹${max.toLocaleString("en-IN")}.`),
        ),
    );

export const applicationDetailsSchema = z
  .object({
    purposes: z
      .array(z.enum(FINANCE_PURPOSES, { error: "Choose what it's for." }))
      .transform((v) => [...new Set(v)])
      .pipe(
        z
          .array(z.enum(FINANCE_PURPOSES))
          .min(1, "Choose what it's for.")
          .max(MAX_PURPOSES, `Choose up to ${MAX_PURPOSES}.`),
      ),
    /** Only kept when "Something else" is chosen. */
    purposeNote: z
      .string()
      .trim()
      .max(PURPOSE_NOTE_MAX, `Keep it to ${PURPOSE_NOTE_MAX} characters.`)
      .optional()
      .transform((v) => (v ? v.replace(/\s+/g, " ") : null)),
    requestedAmount: rupees("an amount", AMOUNT_LIMITS),
    declaredMonthlyIncome: rupees("your average monthly income", { min: 0, max: MONTHLY_INCOME_MAX }),
    declaredMonthlyEmi: rupees("your existing monthly EMIs (0 if none)", { min: 0, max: MONTHLY_INCOME_MAX }),
    incomeSources: z
      .array(z.enum(INCOME_SOURCES))
      .min(1, "Choose at least one income source.")
      .transform((v) => [...new Set(v)]),
  })
  .superRefine((v, ctx) => {
    if (v.purposes.includes("other") && !v.purposeNote) {
      ctx.addIssue({ code: "custom", path: ["purposeNote"], message: "Tell us in a few words what it's for." });
    }
  })
  .transform((v) => ({ ...v, purposeNote: v.purposes.includes("other") ? v.purposeNote : null }));
export type ApplicationDetailsInput = z.output<typeof applicationDetailsSchema>;

/**
 * Personal PAN only (4th character `P`) — Cohort A0 applies as an individual.
 * Used once for the bureau call; never stored, logged or echoed back.
 */
export const panSchema = z
  .string({ error: "Enter your PAN." })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Enter a valid PAN, like ABCPE1234F.")
  .refine((v) => v[3] === "P", "Enter your personal PAN (the 4th character is P).");

/**
 * An Indian mobile number for Account Aggregator discovery: 10 digits starting
 * 6–9, with an optional +91 / 91 / 0 prefix. Passed to the aggregator, never
 * stored (only its last four digits and a keyed fingerprint for duplicates).
 */
export const aaMobileSchema = z
  .string({ error: "Enter a mobile number." })
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number."));

/** "Have you shared every account where you receive creator income?" */
export const bankCoverageSchema = z.discriminatedUnion("allShared", [
  z.object({ allShared: z.literal(true) }),
  z.object({
    allShared: z.literal(false),
    missingReason: z.enum(MISSING_ACCOUNT_REASONS, { error: "Tell us why some accounts are missing." }),
  }),
]);
export type BankCoverageInput = z.output<typeof bankCoverageSchema>;
