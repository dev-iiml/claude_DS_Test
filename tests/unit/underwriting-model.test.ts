import { describe, expect, it } from "vitest";

import {
  COMPONENTS,
  ENHANCED_WEIGHTS,
  POLICY,
  gradeFor,
  principalForEmi,
  runModel,
  underwrite,
  type FeatureSnapshot,
  applyFraudLayer,
} from "@/modules/underwriting/model";

const financial: FeatureSnapshot = {
  bureau_score_band: "high",
  active_credit_accounts: 2,
  delinquencies_12m: 0,
  credit_enquiries_6m: 1,
  avg_monthly_inflow_6m: 120_000,
  inflow_volatility_6m: 0.1,
  avg_monthly_creator_income_6m: 100_000,
  creator_income_share_6m: 0.83,
  creator_income_months_12m: 1,
  avg_monthly_net_cashflow_6m: 40_000,
  declared_monthly_income: 100_000,
  declared_to_observed_income: 1,
  declared_monthly_emi: 10_000,
  emi_to_income: 0.1,
  income_source_count: 3,
  requested_amount: 150_000,
};
const professional: FeatureSnapshot = {
  professional_longevity_months: 60,
  connected_platforms: 2,
  platform_concentration: 0.55,
  growth_stability: 0.8,
  engagement_stability: 0.9,
  posting_consistency_12m: 0.95,
  follower_spike_detected: false,
  handle_mismatches: 0,
  declared_not_connected: 0,
};
const codes = (r: { reasonCodes: { code: string }[] }) => r.reasonCodes.map((c) => c.code);

describe("model configuration", () => {
  it("uses the CLAUDE.md hypothesis weights, summing to 1", () => {
    expect(ENHANCED_WEIGHTS).toEqual({
      financial_strength: 0.35,
      income_stability: 0.2,
      creator_business_stability: 0.15,
      revenue_diversification: 0.1,
      professional_longevity: 0.1,
      audience_authenticity: 0.05,
      brand_recurrence: 0.05,
    });
    expect(COMPONENTS.reduce((t, c) => t + ENHANCED_WEIGHTS[c], 0)).toBeCloseTo(1, 10);
  });

  it.each([
    [85, "A"],
    [80, "A"],
    [79.9, "B"],
    [65, "B"],
    [50, "C"],
    [35, "D"],
    [34.9, "E"],
  ] as const)("grades %s as %s", (score, grade) => expect(gradeFor(score)).toBe(grade));

  it("converts an EMI to a principal with the standard annuity formula", () => {
    expect(principalForEmi(10_000, 12, 0)).toBe(120_000);
    expect(principalForEmi(10_000, 12, 0.2)).toBeCloseTo(107_951, 0);
  });
});

describe("Traditional vs Creator-Enhanced", () => {
  it("scores the same snapshot with both models, deterministically", () => {
    const snap = { ...financial, ...professional };
    const a = underwrite(snap);
    expect(JSON.stringify(a)).toBe(JSON.stringify(underwrite(snap)));
    expect(Object.keys(a.traditional.components).sort()).toEqual(["financial_strength", "income_stability"]);
    expect(Object.keys(a.creatorEnhanced.components)).toHaveLength(7);
    expect(a.traditional.completeness).toBe(1);
    expect(a.creatorEnhanced.completeness).toBe(0.95); // brand recurrence has no data yet
    expect(a.creatorEnhanced.components.brand_recurrence).toBeNull();
    expect(codes(a.creatorEnhanced)).toContain("BRAND_HISTORY_UNAVAILABLE");
    expect(a.delta.score).toBe(Math.round((a.creatorEnhanced.score! - a.traditional.score!) * 10) / 10);
  });

  it("computes component scores from the documented formulas", () => {
    const r = runModel("creator_enhanced", { ...financial, ...professional });
    // bureau high 85, 1 enquiry → 85; emi_to_income 0.1 → 100; 0.6×85 + 0.4×100 = 91
    expect(r.components.financial_strength).toBe(91);
    // cv 0.1 → 85; income months 1 → 100; mean 92.5
    expect(r.components.income_stability).toBe(92.5);
    expect(r.components.creator_business_stability).toBeCloseTo(88.3, 1);
    expect(r.components.professional_longevity).toBe(100);
    expect(r.components.audience_authenticity).toBe(100);
    expect(codes(r)).toEqual(
      expect.arrayContaining(["BUREAU_STRONG", "LOW_EXISTING_OBLIGATIONS", "STEADY_INFLOWS", "ESTABLISHED_CREATOR"]),
    );
  });

  it("recommends an affordability-based amount, capped by grade and the request", () => {
    const r = runModel("creator_enhanced", { ...financial, ...professional, requested_amount: null });
    expect(r.grade).toBe("A");
    // 40% × ₹1,00,000 − ₹10,000 existing = ₹30,000 EMI → ~₹3,23,853 over 12 months; grade A cap 3× = ₹3,00,000.
    expect(r.maxRecommendedExposure).toBe(300_000);
    expect(r.recommendedExposure).toBe(300_000);
    expect(codes(r)).toContain("LIMITED_BY_RISK_GRADE");
    expect(r.recommendedTenorMonths).toBe(POLICY.tenorMonths);

    const asked = runModel("creator_enhanced", { ...financial, ...professional });
    expect(asked.recommendedExposure).toBe(150_000);
    expect(asked.maxRecommendedExposure).toBe(300_000);
    expect(codes(asked)).toContain("LIMITED_BY_REQUEST");
  });

  it("is limited by affordability when existing EMIs are high", () => {
    const r = runModel("traditional", {
      ...financial,
      declared_monthly_emi: 35_000,
      emi_to_income: 0.35,
      requested_amount: null,
    });
    // 40k − 35k = ₹5,000 EMI → ~₹53,976 → ₹50,000
    expect(r.maxRecommendedExposure).toBe(50_000);
    expect(codes(r)).toContain("LIMITED_BY_AFFORDABILITY");
  });

  it("never uses declared income: without bank-verified income it refers with no amount (uw-0.3.0)", () => {
    const noBank: FeatureSnapshot = {
      ...financial,
      avg_monthly_inflow_6m: null,
      inflow_volatility_6m: null,
      avg_monthly_creator_income_6m: null,
      creator_income_share_6m: null,
      creator_income_months_12m: null,
      avg_monthly_net_cashflow_6m: null,
      declared_to_observed_income: null,
      emi_to_income: null,
      bank_coverage: "none",
    };
    const r = runModel("traditional", noBank);
    expect(r.components.income_stability).toBeNull();
    expect(r.completeness).toBeCloseTo(0.636, 3);
    expect(r.grade).not.toBeNull(); // still graded for the lender's information
    expect(r).toMatchObject({
      outcome: "refer",
      incomeBasis: null,
      recommendedExposure: null,
      maxRecommendedExposure: null,
      recommendedTenorMonths: null,
    });
    expect(codes(r)).toEqual(expect.arrayContaining(["NO_BANK_DATA", "NO_VERIFIED_INCOME"]));
    // A high declared income changes nothing.
    expect(runModel("traditional", { ...noBank, declared_monthly_income: 900_000 })).toEqual(r);
    expect(POLICY).not.toHaveProperty("declaredIncomeHaircut");
  });

  it("flags partial bank coverage and caps confidence at medium", () => {
    const full = runModel("creator_enhanced", { ...financial, ...professional, bank_coverage: "complete" });
    expect(full.confidence).toBe("high");
    const partial = runModel("creator_enhanced", { ...financial, ...professional, bank_coverage: "partial" });
    expect(partial.confidence).toBe("medium");
    expect(codes(partial)).toContain("PARTIAL_BANK_COVERAGE");
    expect(partial.incomeBasis).toEqual({ monthly: 100_000, source: "verified" });
  });

  it("refers when there is no bureau summary", () => {
    const r = runModel("creator_enhanced", { ...financial, bureau_score_band: null, ...professional });
    expect(r).toMatchObject({ outcome: "refer", grade: null, score: null, recommendedExposure: null });
    expect(codes(r)).toContain("INSUFFICIENT_DATA");
  });

  it("does not recommend grade E, and flags weak credit", () => {
    const weak: FeatureSnapshot = {
      ...financial,
      bureau_score_band: "low",
      delinquencies_12m: 2,
      credit_enquiries_6m: 5,
      emi_to_income: 0.6,
      inflow_volatility_6m: 0.6,
      creator_income_months_12m: 0.4,
    };
    const r = runModel("traditional", weak);
    expect(r.grade).toBe("E");
    expect(r).toMatchObject({ outcome: "not_recommended", recommendedExposure: 0, recommendedTenorMonths: null });
    expect(codes(r)).toEqual(
      expect.arrayContaining(["BUREAU_WEAK", "RECENT_MISSED_PAYMENTS", "HIGH_RECENT_ENQUIRIES", "VOLATILE_INFLOWS"]),
    );
  });

  it("marks creator signals unavailable, and penalises authenticity concerns", () => {
    expect(codes(runModel("creator_enhanced", financial))).toContain("CREATOR_SIGNALS_UNAVAILABLE");
    const r = runModel("creator_enhanced", {
      ...financial,
      ...professional,
      follower_spike_detected: true,
      handle_mismatches: 1,
    });
    expect(r.components.audience_authenticity).toBe(25);
    expect(codes(r)).toContain("AUTHENTICITY_REVIEW");
  });

  it("never changes the Traditional result when creator signals change", () => {
    const a = runModel("traditional", { ...financial, ...professional });
    const b = runModel("traditional", {
      ...financial,
      ...professional,
      professional_longevity_months: 1,
      follower_spike_detected: true,
    });
    expect(b).toEqual(a);
  });
});

describe("fraud layer (uw-0.2.0)", () => {
  const base = underwrite({ ...financial, ...professional });

  it("clear leaves the comparison untouched", () => {
    expect(applyFraudLayer(base, { outcome: "clear" })).toEqual(base);
  });

  it("review routes recommend to refer, keeps scores and exposures, adds FRAUD_REVIEW", () => {
    const r = applyFraudLayer(base, { outcome: "review" });
    for (const [before, after] of [
      [base.traditional, r.traditional],
      [base.creatorEnhanced, r.creatorEnhanced],
    ] as const) {
      expect(after.outcome).toBe(before.outcome === "recommend" ? "refer" : before.outcome);
      expect(after.score).toBe(before.score);
      expect(after.recommendedExposure).toBe(before.recommendedExposure);
      expect(codes(after)).toContain("FRAUD_REVIEW");
    }
    expect(r.delta).toEqual(base.delta);
  });

  it("watch only adds an informational reason", () => {
    const r = applyFraudLayer(base, { outcome: "watch" });
    expect(r.traditional.outcome).toBe(base.traditional.outcome);
    expect(codes(r.traditional)).toContain("FRAUD_WATCH");
  });
});
