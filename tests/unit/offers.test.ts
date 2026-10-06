import { describe, expect, it } from "vitest";

import { kfsRows } from "@/modules/lending/presentation";
import { MockLenderProvider } from "@/providers/lender/mock-lender-provider";
import {
  apr,
  canonicalTerms,
  emi,
  illustrativeOffer,
  offerTermsSchema,
  repriceIllustrative,
} from "@/providers/lender/offer";
import type { ProposalPayload } from "@/providers/lender/proposal";
import {
  DEFAULT_SIMULATED_POLICY,
  DEFAULT_SIMULATED_PRICING,
  simulatedPolicySchema,
} from "@/providers/lender/simulated-policy";

const base = {
  lenderName: "Simulated partner lender",
  amount: 1_00_000,
  tenorMonths: 12,
  annualInterestRatePct: 18,
  processingFeePct: 2,
  coolingOffDays: 3,
  kfsReference: "SIM-KFS-1",
};

describe("illustrative offer maths", () => {
  it("computes a reducing-balance EMI", () => {
    expect(emi(1_00_000, 18, 12)).toBe(9168); // 9,167.98 rounded up
    expect(emi(1_20_000, 0, 12)).toBe(10_000);
  });

  it("APR includes the upfront fee, so it exceeds the rate", () => {
    const instalment = emi(1_00_000, 18, 12);
    expect(apr(1_00_000, instalment, 12)).toBeCloseTo(18, 0);
    expect(apr(98_000, instalment, 12)).toBeGreaterThan(21);
  });

  it("produces terms that satisfy the KFS schema, labelled simulated", () => {
    const t = illustrativeOffer(base);
    expect(offerTermsSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ sanctionedAmount: 1_00_000, emiAmount: 9168, emiCount: 12, processingFee: 2_000 });
    expect(t.totalRepayable).toBe(9168 * 12 + 2_000);
    expect(t.aprPct).toBeGreaterThan(t.annualInterestRatePct);
    expect(t.grievanceOfficer.name).toMatch(/Simulated/);
  });

  it("re-prices a reduced amount with the same rate and fee percentage", () => {
    const t = repriceIllustrative(illustrativeOffer(base), 50_000, 6);
    expect(t).toMatchObject({
      sanctionedAmount: 50_000,
      tenorMonths: 6,
      annualInterestRatePct: 18,
      processingFee: 1_000,
    });
  });

  it("hashes terms canonically (key order doesn't matter, values do)", () => {
    const t = illustrativeOffer(base);
    const shuffled = Object.fromEntries(Object.entries(t).reverse()) as typeof t;
    expect(canonicalTerms(shuffled)).toBe(canonicalTerms(t));
    expect(canonicalTerms({ ...t, coolingOffDays: 4 })).not.toBe(canonicalTerms(t));
  });

  it("rejects inconsistent terms", () => {
    const t = illustrativeOffer(base);
    expect(offerTermsSchema.safeParse({ ...t, aprPct: 10 }).success).toBe(false);
    expect(offerTermsSchema.safeParse({ ...t, emiCount: 24 }).success).toBe(false);
    expect(offerTermsSchema.safeParse({ ...t, totalRepayable: 1 }).success).toBe(false);
    expect(offerTermsSchema.safeParse({ ...t, termsUrl: "http://x.test/t" }).success).toBe(false);
    expect(offerTermsSchema.safeParse({ ...t, surprise: true }).success).toBe(false);
    // The KFS must add up.
    expect(offerTermsSchema.safeParse({ ...t, totalRepayable: t.totalRepayable - t.processingFee }).success).toBe(
      false,
    );
    expect(offerTermsSchema.safeParse({ ...t, totalInterest: t.totalInterest + 500 }).success).toBe(false);
    expect(offerTermsSchema.safeParse({ ...t, aprPct: t.annualInterestRatePct }).success).toBe(false); // fee ignored
    expect(
      offerTermsSchema.safeParse({
        ...t,
        otherCharges: [{ label: "Stamp duty", amount: 500 }],
        totalRepayable: t.totalRepayable + 500,
      }).success,
    ).toBe(false); // APR now understates the extra charge
    expect(offerTermsSchema.safeParse({ ...t, coolingOffDays: 0 }).success).toBe(false);
  });

  it("shows every KFS item, including APR, cooling-off and the grievance officer", () => {
    const labels = kfsRows(illustrativeOffer(base)).map((r) => r.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Annual Percentage Rate (APR)",
        "Cooling-off period",
        "Grievance officer",
        "Total you repay",
        "KFS reference",
      ]),
    );
  });
});

describe("simulated lender offers", () => {
  it("policy versions saved before Stage 13 get the default illustrative pricing", () => {
    const { pricing: _pricing, ...legacy } = DEFAULT_SIMULATED_POLICY;
    expect(simulatedPolicySchema.parse(legacy).pricing).toEqual(DEFAULT_SIMULATED_PRICING);
  });

  const payload = (outcome: "recommend" | "not_recommended"): ProposalPayload =>
    ({
      schema: 1,
      proposalId: "p",
      applicationRef: "a",
      createdAt: "2026-10-01T10:00:00.000Z",
      dataGroups: ["request", "model_results", "bank_coverage"],
      versions: { underwriting: "uw", financialCapacity: "fin", fraudRules: "fraud" },
      request: { requestedAmount: 1_00_000, purposes: ["equipment"] },
      models: {
        traditional: {
          model: "traditional",
          modelVersion: "uw",
          score: 700,
          grade: "B",
          outcome,
          completeness: 0.9,
          confidence: "high",
          recommendedExposure: outcome === "recommend" ? 1_00_000 : null,
          maxRecommendedExposure: 1_50_000,
          recommendedTenorMonths: 12,
          components: [],
          reasonCodes: [],
        },
        creatorEnhanced: null,
      },
      bankCoverage: { status: "complete", accountsShared: 1, accountsNotReceived: 0 },
    }) as unknown as ProposalPayload;

  it("the mock lender attaches grade-priced terms valid for the policy's days, and none to a decline", async () => {
    const lender = new MockLenderProvider();
    const approved = await lender.getDecision("re_p", {
      proposalId: "11111111-1111-4111-8111-111111111111",
      payload: payload("recommend"),
      simulation: { policy: DEFAULT_SIMULATED_POLICY, policyVersion: 1 },
    });
    expect(approved.offer?.terms).toMatchObject({ sanctionedAmount: 1_00_000, annualInterestRatePct: 18 });
    expect(approved.offer?.expiresAt.toISOString()).toBe("2026-10-08T10:00:00.000Z");
    const declined = await lender.getDecision("re_p", {
      proposalId: "11111111-1111-4111-8111-111111111111",
      payload: payload("not_recommended"),
      simulation: { policy: DEFAULT_SIMULATED_POLICY, policyVersion: 1 },
    });
    expect(declined.offer).toBeNull();
  });
});
