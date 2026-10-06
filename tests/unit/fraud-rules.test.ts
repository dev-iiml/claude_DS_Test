import { describe, expect, it } from "vitest";

import { FRAUD_CHECK_CODES, evaluateFraud, nameMatchScore, type FraudInputs } from "@/modules/fraud/rules";

const clean: FraudInputs = {
  identity_name_match: 1,
  pan_shared_with_other_accounts: 0,
  pan_changes_across_checks: 0,
  declared_to_observed_income: 1.1,
  connected_handle_mismatches: 0,
  declared_tenure_gap_months: 0,
  follower_spike_detected: false,
  engagement_rate_3m: 0.04,
  total_audience: 80_000,
  applications_90d: 1,
};
const empty = Object.fromEntries(Object.keys(clean).map((k) => [k, null])) as unknown as FraudInputs;

const codes = (i: FraudInputs) => evaluateFraud(i).flags.map((f) => [f.code, f.severity]);

describe("fraud rules fraud-0.1.0", () => {
  it("a clean profile passes every check", () => {
    const r = evaluateFraud(clean);
    expect(r).toMatchObject({ outcome: "clear", highestSeverity: null, flags: [] });
    expect(r.checks.map((c) => c.status)).toEqual(FRAUD_CHECK_CODES.map(() => "passed"));
  });

  it("missing inputs mean a check didn't run — never a flag", () => {
    const r = evaluateFraud(empty);
    expect(r.outcome).toBe("clear");
    expect(r.checks.every((c) => c.status === "not_run")).toBe(true);
  });

  it("identity name mismatch: high below 0.5, medium below 0.8", () => {
    expect(codes({ ...clean, identity_name_match: 0.3 })).toEqual([["IDENTITY_NAME_MISMATCH", "high"]]);
    expect(codes({ ...clean, identity_name_match: 0.75 })).toEqual([["IDENTITY_NAME_MISMATCH", "medium"]]);
    expect(codes({ ...clean, identity_name_match: 0.8 })).toEqual([]);
  });

  it("the same PAN on another account is high; a changed PAN is medium", () => {
    expect(codes({ ...clean, pan_shared_with_other_accounts: 1 })).toEqual([["DUPLICATE_PAN_ACCOUNTS", "high"]]);
    expect(codes({ ...clean, pan_changes_across_checks: 1 })).toEqual([["PAN_CHANGED_ACROSS_CHECKS", "medium"]]);
  });

  it("declared income far above observed: medium above 1.5×, high above 2.5×", () => {
    expect(codes({ ...clean, declared_to_observed_income: 1.5 })).toEqual([]);
    expect(codes({ ...clean, declared_to_observed_income: 1.6 })).toEqual([["DECLARED_INCOME_INCONSISTENT", "medium"]]);
    expect(codes({ ...clean, declared_to_observed_income: 3 })).toEqual([["DECLARED_INCOME_INCONSISTENT", "high"]]);
  });

  it("account and audience signals", () => {
    expect(codes({ ...clean, connected_handle_mismatches: 2 })).toEqual([["CONNECTED_HANDLE_MISMATCH", "medium"]]);
    expect(codes({ ...clean, declared_tenure_gap_months: 30 })).toEqual([["DECLARED_TENURE_UNSUPPORTED", "low"]]);
    expect(codes({ ...clean, follower_spike_detected: true })).toEqual([["SUSPICIOUS_FOLLOWER_SPIKE", "medium"]]);
    expect(codes({ ...clean, engagement_rate_3m: 0.25, total_audience: 20_000 })).toEqual([
      ["ANOMALOUS_ENGAGEMENT", "medium"],
    ]);
    expect(codes({ ...clean, engagement_rate_3m: 0.25, total_audience: 5_000 })).toEqual([]);
    expect(codes({ ...clean, engagement_rate_3m: 0.001, total_audience: 60_000 })).toEqual([
      ["ANOMALOUS_ENGAGEMENT", "medium"],
    ]);
    expect(codes({ ...clean, applications_90d: 3 })).toEqual([["APPLICATION_VELOCITY", "low"]]);
  });

  it("outcome: review on any high flag, watch for lower ones", () => {
    expect(evaluateFraud({ ...clean, applications_90d: 4 }).outcome).toBe("watch");
    const r = evaluateFraud({ ...clean, applications_90d: 4, pan_shared_with_other_accounts: 2 });
    expect(r).toMatchObject({ outcome: "review", highestSeverity: "high" });
  });

  it("is deterministic", () => {
    const i = { ...clean, identity_name_match: 0.6, follower_spike_detected: true };
    expect(evaluateFraud(i)).toEqual(evaluateFraud({ ...i }));
  });
});

describe("name match score", () => {
  it("ignores case, order, punctuation and honorifics", () => {
    expect(nameMatchScore("Uma Rao", "RAO, uma")).toBe(1);
    expect(nameMatchScore("Mr. Neel Shah", "neel shah")).toBe(1);
  });

  it("gives half credit to initials and compares against the shorter name", () => {
    expect(nameMatchScore("Neel K Shah", "Neel Kumar Shah")).toBeCloseTo(0.833, 3);
    expect(nameMatchScore("Uma Rao", "Uma Lakshmi Rao")).toBe(1);
  });

  it("different people score low", () => {
    expect(nameMatchScore("Uma Rao", "Kabir Sethi")).toBe(0);
    expect(nameMatchScore("Uma Rao", "Uma Sethi")).toBe(0.5);
  });

  it("matches exact tokens before initials, so surname-first records aren't flagged", () => {
    expect(nameMatchScore("S Sharma", "Sharma Sunil")).toBe(0.75);
    expect(nameMatchScore("Sunil Sharma", "SHARMA SUNIL")).toBe(1);
  });

  it("returns null (check not run) when a name has no comparable Latin tokens", () => {
    expect(nameMatchScore("", "Uma")).toBeNull();
    expect(nameMatchScore("सुनील शर्मा", "Sunil Sharma")).toBeNull();
    expect(nameMatchScore("Mr. Dr.", "Sunil Sharma")).toBeNull();
  });
});
