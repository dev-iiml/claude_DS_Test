import { describe, expect, it } from "vitest";

import { LENDER_SHARING_SCOPES, uncoveredGroups } from "@/modules/lending/domain";
import { buildProposalPayload, canonicalJson, type ProposalSource } from "@/modules/lending/payload";
import { MockLenderProvider } from "@/providers/lender/mock-lender-provider";
import { MINIMUM_PROPOSAL_PROFILE, type ProposalModelResult } from "@/providers/lender/proposal";
import {
  DEFAULT_SIMULATED_POLICY,
  evaluateSimulatedPolicy,
  simulatedPolicySchema,
} from "@/providers/lender/simulated-policy";

const model = (over: Partial<ProposalModelResult> = {}): ProposalModelResult => ({
  model: "traditional",
  modelVersion: "uw-0.3.0",
  score: 72,
  grade: "B",
  outcome: "recommend",
  completeness: 1,
  confidence: "high",
  recommendedExposure: 1_50_000,
  maxRecommendedExposure: 1_50_000,
  recommendedTenorMonths: 12,
  components: { financial_strength: 70 },
  reasonCodes: ["STEADY_INFLOWS"],
  ...over,
});

const source = (over: Partial<ProposalSource> = {}): ProposalSource => ({
  proposalId: "p1",
  applicationRef: "a1",
  createdAt: new Date("2026-10-03T10:00:00Z"),
  groups: MINIMUM_PROPOSAL_PROFILE,
  versions: { underwriting: "uw-0.3.0", financialCapacity: "fin-0.2.0", fraudRules: "fraud-0.1.0" },
  request: { requestedAmount: 1_50_000, purposes: ["equipment"] },
  financialCapacity: [{ key: "delinquencies_12m", value: 0, unit: "count", confidence: "high" }],
  models: {
    traditional: model(),
    creatorEnhanced: model({ model: "creator_enhanced", grade: "A", recommendedExposure: 2_40_000 }),
  },
  bankCoverage: { status: "complete", accountsShared: 2, accountsNotReceived: 0 },
  fraud: { outcome: "clear", flags: [{ code: "X", severity: "low", evidence: { n: 1 } }] },
  professionalFeatures: { professional_longevity_months: 40 },
  ...over,
});

describe("credit proposal payload", () => {
  it("includes only the partnership's data groups — the minimum by default", () => {
    const p = buildProposalPayload(source());
    expect(p.dataGroups).toEqual(MINIMUM_PROPOSAL_PROFILE);
    expect(p).toMatchObject({ schema: 1, fraud: { outcome: "clear" }, bankCoverage: { status: "complete" } });
    expect(p.professionalFeatures).toBeUndefined();
    expect(p.fraudFlags).toBeUndefined();
    // The request is always there, even if a profile leaves it out.
    const lean = buildProposalPayload(source({ groups: ["model_results"] }));
    expect(lean.dataGroups).toEqual(["request", "model_results"]);
    expect(lean.financialCapacity).toBeUndefined();
    // Broader partnership terms add groups.
    const broad = buildProposalPayload(
      source({ groups: [...MINIMUM_PROPOSAL_PROFILE, "professional_features", "fraud_flag_details"] }),
    );
    expect(broad.professionalFeatures).toEqual({ professional_longevity_months: 40 });
    expect(broad.fraudFlags).toHaveLength(1);
  });

  it("doesn't reveal the fraud outcome through reason codes when the fraud summary isn't shared", () => {
    const withFraud = source({
      models: { traditional: model({ reasonCodes: ["STEADY_INFLOWS", "FRAUD_WATCH"] }), creatorEnhanced: null },
    });
    expect(buildProposalPayload(withFraud).models!.traditional!.reasonCodes).toContain("FRAUD_WATCH");
    const lean = buildProposalPayload({ ...withFraud, groups: ["request", "model_results"] });
    expect(lean.models!.traditional!.reasonCodes).toEqual(["STEADY_INFLOWS"]);
  });

  it("hashes canonically (key order doesn't matter)", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  it("never sends more than the creator's consent version covers", () => {
    expect(uncoveredGroups(MINIMUM_PROPOSAL_PROFILE, 1)).toEqual([]);
    expect(uncoveredGroups([...MINIMUM_PROPOSAL_PROFILE, "fraud_flag_details"], 1)).toEqual(["fraud_flag_details"]);
    expect(uncoveredGroups(["request"], 99)).toEqual(["request"]);
    expect(LENDER_SHARING_SCOPES[1]).not.toContain("professional_features");
  });
});

describe("simulated partner-lender policy", () => {
  const decide = (over: Partial<ProposalSource> = {}, policy = DEFAULT_SIMULATED_POLICY) =>
    evaluateSimulatedPolicy(buildProposalPayload(source(over)), policy);

  it("decides on Traditional by default and caps the amount", () => {
    expect(decide()).toEqual({
      outcome: "approved",
      approvedExposure: 1_50_000,
      approvedTenorMonths: 12,
      decisionBasis: "traditional",
      reasonCodes: [],
      grade: expect.any(String),
    });
    const enhanced = decide({}, { ...DEFAULT_SIMULATED_POLICY, decisionBasis: "creator_enhanced" });
    expect(enhanced).toMatchObject({
      outcome: "modified",
      approvedExposure: 2_00_000,
      reasonCodes: ["RE_POLICY_EXPOSURE_CAP"],
    });
  });

  it.each([
    [
      { models: { traditional: model({ outcome: "refer", recommendedExposure: null }), creatorEnhanced: null } },
      "RE_NO_RECOMMENDED_AMOUNT",
    ],
    [
      { models: { traditional: model({ outcome: "not_recommended", grade: "E" }), creatorEnhanced: null } },
      "RE_NOT_RECOMMENDED",
    ],
    [{ models: { traditional: model({ grade: "E" }), creatorEnhanced: null } }, "RE_POLICY_GRADE"],
    [{ models: { traditional: model({ completeness: 0.4 }), creatorEnhanced: null } }, "RE_POLICY_DATA_COMPLETENESS"],
    [
      { financialCapacity: [{ key: "delinquencies_12m", value: 1, unit: "count", confidence: "high" }] },
      "RE_POLICY_DELINQUENCY",
    ],
    [
      { bankCoverage: { status: "none" as const, accountsShared: 0, accountsNotReceived: 0 } },
      "RE_POLICY_BANK_COVERAGE",
    ],
  ])("declines %#", (over, code) => {
    expect(decide(over as Partial<ProposalSource>)).toMatchObject({
      outcome: "declined",
      approvedExposure: null,
      reasonCodes: [code],
    });
  });

  it("decides a released referral on its recommended amount, and says so", () => {
    const referred = decide({
      models: { traditional: model({ outcome: "refer", reasonCodes: ["FRAUD_REVIEW"] }), creatorEnhanced: null },
    });
    expect(referred).toMatchObject({
      outcome: "approved",
      approvedExposure: 1_50_000,
      reasonCodes: ["RE_REFERRED_CASE"],
    });
  });

  it("validates policy versions strictly", () => {
    expect(simulatedPolicySchema.safeParse(DEFAULT_SIMULATED_POLICY).success).toBe(true);
    expect(simulatedPolicySchema.safeParse({ ...DEFAULT_SIMULATED_POLICY, maxExposure: 5 }).success).toBe(false);
    expect(simulatedPolicySchema.safeParse({ ...DEFAULT_SIMULATED_POLICY, extra: 1 }).success).toBe(false);
  });

  it("the mock lender applies the policy it's sent, deterministically", async () => {
    const lender = new MockLenderProvider();
    const proposal = {
      proposalId: "p1",
      payload: buildProposalPayload(source()),
      simulation: { policy: { ...DEFAULT_SIMULATED_POLICY, maxExposure: 1_00_000 }, policyVersion: 7 },
    };
    const { lenderReference } = await lender.submitProposal(proposal);
    const d = await lender.getDecision(lenderReference, proposal);
    expect(d).toMatchObject({
      outcome: "modified",
      approvedExposure: 1_00_000,
      policyVersion: 7,
      decisionBasis: "traditional",
    });
    expect(d.decidedAt!.toISOString()).toBe("2026-10-03T10:00:00.000Z");
    expect(await lender.getDecision(lenderReference, proposal)).toEqual(d);
    expect(lender.proposalProfile()).toEqual(MINIMUM_PROPOSAL_PROFILE);
  });
});
