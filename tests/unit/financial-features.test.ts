import { describe, expect, it } from "vitest";

import {
  FIN_FEATURE_VERSIONS,
  computeFinancialFeatures,
  type FinancialEngineInput,
} from "@/modules/financial-eligibility/financial-features";
import { hashFinancialInputs } from "@/modules/financial-eligibility/inputs-hash";
import { FIN_FEATURE_COPY, formatFinValue } from "@/modules/financial-eligibility/presentation";
import {
  aaMobileSchema,
  applicationDetailsSchema,
  bankCoverageSchema,
  panSchema,
} from "@/modules/financial-eligibility/schemas";

const months = (n: number, inflow = 100_000, creator: number | null = 80_000) =>
  Array.from({ length: n }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    inflow,
    outflow: 60_000,
    creatorIncome: creator,
  }));

const input = (over: Partial<FinancialEngineInput> = {}): FinancialEngineInput => ({
  asOf: "2026-10-01",
  declared: { monthlyIncome: 80_000, monthlyEmi: 8_000, incomeSources: ["brand_deals", "platform_payouts"] },
  bureau: { scoreBand: "medium", activeTradelines: 2, delinquentTradelines12m: 0, enquiries6m: 1 },
  cashflow: months(9),
  coverage: { status: "complete", accountsShared: 2, accountsNotReceived: 0 },
  ...over,
});
const byKey = (i: FinancialEngineInput) => Object.fromEntries(computeFinancialFeatures(i).map((f) => [f.key, f]));

describe("Financial Capacity engine fin-0.2.0", () => {
  it("emits every feature once, versioned, deterministically", () => {
    const a = computeFinancialFeatures(input());
    expect(a.map((f) => f.key).sort()).toEqual(Object.keys(FIN_FEATURE_VERSIONS).sort());
    expect(JSON.stringify(a)).toBe(JSON.stringify(computeFinancialFeatures(input())));
  });

  it("summarises the last six months of cashflow", () => {
    const f = byKey(input());
    expect(f.avg_monthly_inflow_6m).toMatchObject({
      value: 100_000,
      source: "verified",
      confidence: "high",
      completeness: 1,
    });
    expect(f.avg_monthly_creator_income_6m!.value).toBe(80_000);
    expect(f.creator_income_share_6m!.value).toBe(0.8);
    expect(f.avg_monthly_net_cashflow_6m!.value).toBe(40_000);
    expect(f.inflow_volatility_6m!.value).toBe(0);
    expect(f.creator_income_months_12m!.value).toBe(1);
  });

  it("compares declared with observed income and computes obligations", () => {
    const f = byKey(
      input({ declared: { monthlyIncome: 160_000, monthlyEmi: 16_000, incomeSources: ["brand_deals"] } }),
    );
    expect(f.declared_to_observed_income!.value).toBe(2);
    expect(f.emi_to_income).toMatchObject({ value: 0.2, provenance: { income_basis: "verified" } });
    expect(f.income_source_count!.value).toBe(1);
  });

  it("never measures obligations against declared income (bank-verified income only)", () => {
    const f = byKey(input({ cashflow: [], coverage: { status: "none", accountsShared: 0, accountsNotReceived: 0 } }));
    expect(f.avg_monthly_inflow_6m).toMatchObject({ value: null, completeness: 0, confidence: "low" });
    expect(f.declared_to_observed_income!.value).toBeNull();
    expect(f.emi_to_income).toMatchObject({ value: null, completeness: 0, provenance: { income_basis: "none" } });
    // Inflows with no classifiable creator income are not income either.
    const noCreator = byKey(input({ cashflow: months(6, 100_000, 0) }));
    expect(noCreator.emi_to_income!.value).toBeNull();
  });

  it("compares declared with observed income only when every income account is shared", () => {
    const partial = byKey(input({ coverage: { status: "partial", accountsShared: 1, accountsNotReceived: 1 } }));
    expect(partial.declared_to_observed_income).toMatchObject({ value: null, completeness: 0 });
    // Obligations still use the verified income, with lower confidence.
    expect(partial.emi_to_income).toMatchObject({ value: 0.1, confidence: "low" });
    expect(partial.bank_coverage).toMatchObject({ value: "partial" });
    expect(partial.bank_accounts_not_received!.value).toBe(1);
    expect(byKey(input()).bank_accounts_shared!.value).toBe(2);
  });

  it("handles a missing bureau summary and a no-hit result", () => {
    expect(byKey(input({ bureau: null })).bureau_score_band).toMatchObject({ value: null, completeness: 0 });
    const noHit = byKey(
      input({ bureau: { scoreBand: "no_hit", activeTradelines: 0, delinquentTradelines12m: 0, enquiries6m: 0 } }),
    );
    expect(noHit.bureau_score_band!.value).toBe("no_hit");
  });

  it("measures volatility and income gaps", () => {
    const uneven = [...months(3, 50_000), ...months(3, 150_000)].map((m, i) => ({ ...m, month: `2026-0${i + 1}` }));
    uneven[2]!.creatorIncome = 0;
    const f = byKey(input({ cashflow: uneven }));
    expect(f.inflow_volatility_6m!.value).toBe(0.5);
    expect(f.creator_income_months_12m!.value).toBeCloseTo(5 / 6, 4);
  });

  it("never outputs an eligibility, limit or score", () => {
    expect(Object.keys(FIN_FEATURE_VERSIONS).join(" ")).not.toMatch(/eligib|limit|approv|score_value|exposure/);
  });

  it("hashes inputs order-independently and sensitively", () => {
    const a = input();
    const b = input({
      cashflow: [...months(9)].reverse(),
      declared: { ...a.declared, incomeSources: ["platform_payouts", "brand_deals"] },
    });
    expect(hashFinancialInputs(a)).toBe(hashFinancialInputs(b));
    expect(hashFinancialInputs(input({ declared: { ...a.declared, monthlyEmi: 8_001 } }))).not.toBe(
      hashFinancialInputs(a),
    );
    expect(
      hashFinancialInputs(input({ coverage: { status: "partial", accountsShared: 2, accountsNotReceived: 0 } })),
    ).not.toBe(hashFinancialInputs(a));
  });
});

describe("presentation", () => {
  it("has copy for every feature and formats values", () => {
    for (const key of Object.keys(FIN_FEATURE_VERSIONS) as (keyof typeof FIN_FEATURE_VERSIONS)[])
      expect(FIN_FEATURE_COPY[key]).toBeTruthy();
    expect(formatFinValue("avg_monthly_inflow_6m", 150000)).toBe("₹1,50,000");
    expect(formatFinValue("bureau_score_band", "no_hit")).toBe("No credit history found");
    expect(formatFinValue("emi_to_income", 0.234)).toBe("23%");
    expect(formatFinValue("declared_to_observed_income", 1.1)).toBe("Matches");
    expect(formatFinValue("declared_to_observed_income", 2)).toBe("Higher than seen");
    expect(formatFinValue("avg_monthly_inflow_6m", null)).toBe("Not available");
    expect(formatFinValue("bank_coverage", "complete")).toBe("Every account with creator income");
  });
});

describe("application inputs", () => {
  const ok = {
    purposes: ["equipment"],
    requestedAmount: "1,50,000",
    declaredMonthlyIncome: "₹ 80,000",
    declaredMonthlyEmi: "0",
    incomeSources: ["brand_deals", "brand_deals"],
  };
  it("parses Indian-formatted rupee amounts", () => {
    expect(applicationDetailsSchema.parse(ok)).toEqual({
      purposes: ["equipment"],
      purposeNote: null,
      requestedAmount: 150000,
      declaredMonthlyIncome: 80000,
      declaredMonthlyEmi: 0,
      incomeSources: ["brand_deals"],
    });
  });
  it.each([
    [{ requestedAmount: "5000" }, "requestedAmount"],
    [{ requestedAmount: "30,00,000" }, "requestedAmount"],
    [{ declaredMonthlyIncome: "1.5L" }, "declaredMonthlyIncome"],
    [{ incomeSources: [] }, "incomeSources"],
    [{ purposes: ["holiday"] }, "purposes"],
    [{ purposes: [] }, "purposes"],
    [{ purposes: ["equipment", "marketing", "education", "studio_setup"] }, "purposes"],
  ])("rejects %j", (patch, field) => {
    const r = applicationDetailsSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path[0]).toBe(field);
  });
  it("takes up to three purposes in order, and a short note only with “Something else”", () => {
    const r = applicationDetailsSchema.parse({ ...ok, purposes: ["studio_setup", "equipment", "studio_setup"] });
    expect(r.purposes).toEqual(["studio_setup", "equipment"]);
    expect(applicationDetailsSchema.parse({ ...ok, purposeNote: "ignored" }).purposeNote).toBeNull();
    const other = applicationDetailsSchema.parse({ ...ok, purposes: ["other"], purposeNote: "  a  podcast studio " });
    expect(other).toMatchObject({ purposes: ["other"], purposeNote: "a podcast studio" });
    const missing = applicationDetailsSchema.safeParse({ ...ok, purposes: ["other"] });
    expect(missing.error!.issues[0]!.path).toEqual(["purposeNote"]);
    expect(
      applicationDetailsSchema.safeParse({ ...ok, purposes: ["other"], purposeNote: "x".repeat(141) }).success,
    ).toBe(false);
  });
  it("normalises Indian mobile numbers for the Account Aggregator", () => {
    expect(aaMobileSchema.parse("+91 98765 43210")).toBe("9876543210");
    expect(aaMobileSchema.parse("09876543210")).toBe("9876543210");
    expect(aaMobileSchema.parse("919876543210")).toBe("9876543210");
    expect(aaMobileSchema.safeParse("5876543210").success).toBe(false);
    expect(aaMobileSchema.safeParse("98765").success).toBe(false);
  });
  it("needs a reason when some accounts are missing", () => {
    expect(bankCoverageSchema.parse({ allShared: true })).toEqual({ allShared: true });
    expect(bankCoverageSchema.safeParse({ allShared: false }).success).toBe(false);
    expect(bankCoverageSchema.parse({ allShared: false, missingReason: "bank_not_on_aa" })).toMatchObject({
      missingReason: "bank_not_on_aa",
    });
  });
  it("accepts personal PANs only", () => {
    expect(panSchema.parse(" abcpe1234f ")).toBe("ABCPE1234F");
    expect(panSchema.safeParse("ABCCE1234F").success).toBe(false); // company PAN
    expect(panSchema.safeParse("ABCP1234F").success).toBe(false);
  });
});
