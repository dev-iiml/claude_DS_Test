import { z } from "zod";

import type { ProposalModelName, ProposalPayload } from "./proposal";

/**
 * ILLUSTRATIVE pricing for the simulated lender's offers (Stage 13). Placeholder
 * values for the pilot demo only — not a pricing recommendation and not any
 * lender's rates. Edited through the same maker-checker as the rest of the policy.
 */
export const simulatedPricingSchema = z
  .object({
    annualRatePctByGrade: z
      .object({
        A: z.number().min(0).max(60),
        B: z.number().min(0).max(60),
        C: z.number().min(0).max(60),
        D: z.number().min(0).max(60),
        E: z.number().min(0).max(60),
      })
      .strict(),
    processingFeePct: z.number().min(0).max(10),
    offerValidDays: z.number().int().min(1).max(60),
    coolingOffDays: z.number().int().min(3).max(30),
  })
  .strict();
export type SimulatedPricing = z.infer<typeof simulatedPricingSchema>;

export const DEFAULT_SIMULATED_PRICING: SimulatedPricing = {
  annualRatePctByGrade: { A: 16, B: 18, C: 21, D: 24, E: 26 },
  processingFeePct: 2,
  offerValidDays: 7,
  coolingOffDays: 3,
};

/**
 * The SIMULATED partner-lender credit policy (Stage 12). Used only by the
 * mock lender so the pilot can show an end-to-end decision. A real bank/NBFC
 * applies its own approved credit policy; nothing here represents one.
 * Pure and deterministic. Versions are managed (maker-checker) by the lending
 * module; the mock receives the active version with each proposal.
 */
const GRADES = ["A", "B", "C", "D", "E"] as const;

export const simulatedPolicySchema = z
  .object({
    /** Which CreatorCo model the simulated lender decides on (user decision: default Traditional). */
    decisionBasis: z.enum(["traditional", "creator_enhanced"]),
    /** Worst grade the lender accepts. */
    minGrade: z.enum(GRADES),
    /** Exposure cap; larger recommendations are approved with changes, at the cap. */
    maxExposure: z.number().int().min(10_000).max(25_00_000),
    maxTenorMonths: z.number().int().min(3).max(60),
    /** Missed payments in 12 months above this → not approved. */
    maxDelinquencies12m: z.number().int().min(0).max(10),
    /** Least bank coverage accepted. */
    minBankCoverage: z.enum(["none", "partial", "complete"]),
    /** Least model completeness accepted, 0–1. */
    minCompleteness: z.number().min(0).max(1),
    /** Illustrative offer pricing (Stage 13); versions saved before it get the default. */
    pricing: simulatedPricingSchema.default(DEFAULT_SIMULATED_PRICING),
  })
  .strict();
export type SimulatedLenderPolicy = z.infer<typeof simulatedPolicySchema>;

export const DEFAULT_SIMULATED_POLICY: SimulatedLenderPolicy = {
  decisionBasis: "traditional",
  minGrade: "D",
  maxExposure: 2_00_000,
  maxTenorMonths: 12,
  maxDelinquencies12m: 0,
  minBankCoverage: "partial",
  minCompleteness: 0.5,
  pricing: DEFAULT_SIMULATED_PRICING,
};

export interface SimulatedDecision {
  outcome: "approved" | "modified" | "declined";
  approvedExposure: number | null;
  approvedTenorMonths: number | null;
  decisionBasis: ProposalModelName;
  reasonCodes: string[];
  /** Grade of the model the decision was based on (prices the illustrative offer). */
  grade: (typeof GRADES)[number] | null;
}

const COVERAGE_RANK = { none: 0, partial: 1, complete: 2 } as const;

export function evaluateSimulatedPolicy(payload: ProposalPayload, policy: SimulatedLenderPolicy): SimulatedDecision {
  const basis = policy.decisionBasis;
  const decline = (code: string): SimulatedDecision => ({
    outcome: "declined",
    approvedExposure: null,
    approvedTenorMonths: null,
    decisionBasis: basis,
    reasonCodes: [code],
    grade: null,
  });
  const result = basis === "traditional" ? payload.models?.traditional : payload.models?.creatorEnhanced;
  if (!result) return decline("RE_MODEL_RESULT_MISSING");
  if (result.outcome === "not_recommended") return decline("RE_NOT_RECOMMENDED");
  // A referral without an amount (e.g. no verified income) can't be priced; one with an amount was referred for
  // review (e.g. by the fraud layer) and only reaches the lender after CreatorCo released it.
  if (result.recommendedExposure === null) return decline("RE_NO_RECOMMENDED_AMOUNT");
  if (!result.grade || GRADES.indexOf(result.grade as (typeof GRADES)[number]) > GRADES.indexOf(policy.minGrade))
    return decline("RE_POLICY_GRADE");
  if (result.completeness < policy.minCompleteness) return decline("RE_POLICY_DATA_COMPLETENESS");
  const delinquencies = payload.financialCapacity?.find((f) => f.key === "delinquencies_12m")?.value;
  if (typeof delinquencies === "number" && delinquencies > policy.maxDelinquencies12m)
    return decline("RE_POLICY_DELINQUENCY");
  const coverage = payload.bankCoverage?.status ?? "none";
  if (COVERAGE_RANK[coverage] < COVERAGE_RANK[policy.minBankCoverage]) return decline("RE_POLICY_BANK_COVERAGE");

  const reasons: string[] = result.outcome === "refer" ? ["RE_REFERRED_CASE"] : [];
  let exposure = result.recommendedExposure;
  let tenor = result.recommendedTenorMonths ?? policy.maxTenorMonths;
  if (exposure > policy.maxExposure) {
    exposure = policy.maxExposure;
    reasons.push("RE_POLICY_EXPOSURE_CAP");
  }
  if (tenor > policy.maxTenorMonths) {
    tenor = policy.maxTenorMonths;
    reasons.push("RE_POLICY_TENOR_CAP");
  }
  const capped = reasons.some((r) => r !== "RE_REFERRED_CASE");
  return {
    outcome: capped ? "modified" : "approved",
    approvedExposure: exposure,
    approvedTenorMonths: tenor,
    decisionBasis: basis,
    reasonCodes: reasons,
    grade: result.grade as (typeof GRADES)[number],
  };
}
