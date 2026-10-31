import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EARN_RULES,
  EARN_RULE_CODES,
  EARN_TRIGGERS,
  brandPaymentMilestoneRules,
  brandWorkMilestoneRules,
  earnKeyFor,
  membershipYears,
  reverseKeyFor,
  taskGuardrailViolations,
} from "@/modules/rewards/rules";
import { restrictedTextKinds } from "@/lib/restricted-text";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

describe("Creator Points rules pts-0.2.0", () => {
  it("no earn rule is triggered by a consent, credit or bank data", () => {
    const forbidden = /consent|credit|loan|eligib|bank|aa_|account_aggregator|offer|bureau/i;
    for (const t of EARN_TRIGGERS) expect(t).not.toMatch(forbidden);
    for (const code of EARN_RULE_CODES) {
      expect(code).not.toMatch(forbidden);
      expect(EARN_TRIGGERS).toContain(EARN_RULES[code].trigger);
    }
  });

  it("consent, financial-eligibility, lending and underwriting code never grants points", () => {
    for (const dir of ["consent", "financial-eligibility", "lending", "underwriting", "privacy"]) {
      for (const f of files(join("src/modules", dir))) {
        const src = readFileSync(f, "utf8");
        expect(src, f).not.toMatch(/earnPoints|syncMilestonePoints|rewards\/ledger-service/);
      }
    }
  });

  it("payment milestones are the same whatever the confirmation method (method isn't an input) and take counts only", () => {
    expect(brandPaymentMilestoneRules.length).toBe(1);
    expect(brandWorkMilestoneRules.length).toBe(1);
    expect(brandPaymentMilestoneRules(0)).toEqual([]);
    expect(brandPaymentMilestoneRules(5)).toEqual(["brand_payment_confirmed_1", "brand_payment_confirmed_5"]);
    expect(brandWorkMilestoneRules(25)).toHaveLength(4);
    expect(brandWorkMilestoneRules(4)).toEqual(["brand_work_verified_1"]);
  });

  it("rewards rules never read an amount", () => {
    const src = readFileSync("src/modules/rewards/rules.ts", "utf8");
    expect(src).not.toMatch(/amountPaise|invoiceAmount|paise/i);
  });

  it("earn keys: once vs repeatable; reversal keys are distinct", () => {
    expect(earnKeyFor("welcome")).toBe("welcome");
    expect(earnKeyFor("membership_anniversary", 2)).toBe("membership_anniversary:2");
    expect(() => earnKeyFor("access_completed")).toThrow();
    expect(reverseKeyFor("brand_work_verified_1")).toBe("reverse:brand_work_verified_1");
  });

  it("membership years count completed anniversaries", () => {
    const since = new Date("2025-03-10T00:00:00Z");
    expect(membershipYears(since, new Date("2026-03-09T23:00:00Z"))).toBe(0);
    expect(membershipYears(since, new Date("2026-03-10T00:00:00Z"))).toBe(1);
    expect(membershipYears(since, new Date("2028-12-01T00:00:00Z"))).toBe(3);
  });

  it("task guardrails block consent, credit and bank wording; notes reject identifiers", () => {
    expect(taskGuardrailViolations("Renew your bank-data consent")).toEqual(
      expect.arrayContaining(["consent", "bank"]),
    );
    expect(taskGuardrailViolations("Apply for a loan")).toEqual(expect.arrayContaining(["loan", "apply for"]));
    expect(taskGuardrailViolations("Attend the Mumbai creator meetup")).toEqual([]);
    expect(taskGuardrailViolations("Expand your panel of guests")).toEqual([]);
    expect(restrictedTextKinds("Checked on the call, ABCDE1234F")).toContain("pan");
    expect(restrictedTextKinds("Saw the reel on 3 Oct")).toEqual([]);
  });
});
