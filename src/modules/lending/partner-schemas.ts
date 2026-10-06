import { z } from "zod";

import { canonicalTerms, offerTermsSchema } from "@/providers/lender/offer";

import { DECISION_EXPOSURE_RANGE, DECISION_OUTCOMES, DECISION_TENOR_RANGE } from "./domain";

/**
 * Body of `POST /api/partner/v1/proposals/{id}/decision` (Stage 12b). Pure
 * (shared with docs/tests). Amounts in whole rupees.
 */
export const partnerDecisionSchema = z
  .object({
    outcome: z.enum(DECISION_OUTCOMES),
    approvedExposure: z
      .number()
      .int()
      .min(DECISION_EXPOSURE_RANGE.min)
      .max(DECISION_EXPOSURE_RANGE.max)
      .nullable()
      .optional(),
    approvedTenorMonths: z
      .number()
      .int()
      .min(DECISION_TENOR_RANGE.min)
      .max(DECISION_TENOR_RANGE.max)
      .nullable()
      .optional(),
    decisionBasis: z.enum(["traditional", "creator_enhanced"]).nullable().optional(),
    reasonCodes: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, "Reason codes are UPPER_SNAKE_CASE."))
      .max(20)
      .default([]),
    decidedAt: z.iso.datetime({ offset: true }).optional(),
    lenderReference: z
      .string()
      .regex(/^[A-Za-z0-9_.:-]{1,80}$/)
      .optional(),
    /** Stage 13: required unless declined — the terms and Key Fact Statement, and until when they stand. */
    offer: z
      .object({
        expiresAt: z.iso.datetime({ offset: true }),
        terms: offerTermsSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.outcome === "declined") {
      if (d.approvedExposure != null)
        ctx.addIssue({ code: "custom", path: ["approvedExposure"], message: "Leave out the amount for a decline." });
      if (d.approvedTenorMonths != null)
        ctx.addIssue({ code: "custom", path: ["approvedTenorMonths"], message: "Leave out the tenor for a decline." });
    } else {
      if (d.approvedExposure == null)
        ctx.addIssue({ code: "custom", path: ["approvedExposure"], message: "The approved amount is required." });
      if (d.approvedTenorMonths == null)
        ctx.addIssue({ code: "custom", path: ["approvedTenorMonths"], message: "The approved tenor is required." });
      if (!d.offer) {
        ctx.addIssue({ code: "custom", path: ["offer"], message: "The offer terms (and KFS) are required." });
      } else {
        if (d.offer.terms.sanctionedAmount !== d.approvedExposure)
          ctx.addIssue({
            code: "custom",
            path: ["offer", "terms", "sanctionedAmount"],
            message: "Must equal approvedExposure.",
          });
        if (d.offer.terms.tenorMonths !== d.approvedTenorMonths)
          ctx.addIssue({
            code: "custom",
            path: ["offer", "terms", "tenorMonths"],
            message: "Must equal approvedTenorMonths.",
          });
      }
    }
    if (d.outcome === "declined" && d.offer)
      ctx.addIssue({ code: "custom", path: ["offer"], message: "A decline has no offer." });
  });
export type PartnerDecisionBody = z.output<typeof partnerDecisionSchema>;

/** Idempotency-Key header format. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;

/** Canonical form of a decision body (for the idempotency hash). */
export function canonicalDecision(d: PartnerDecisionBody): string {
  return JSON.stringify([
    d.outcome,
    d.approvedExposure ?? null,
    d.approvedTenorMonths ?? null,
    d.decisionBasis ?? null,
    d.reasonCodes,
    d.decidedAt ? new Date(d.decidedAt).toISOString() : null,
    d.lenderReference ?? null,
    d.offer ? [new Date(d.offer.expiresAt).toISOString(), canonicalTerms(d.offer.terms)] : null,
  ]);
}
