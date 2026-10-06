import { describe, expect, it } from "vitest";

import { CONSENT_KEYS, ERASURE_SCOPES } from "@/modules/consent/domain";
import { definitionFingerprint } from "@/modules/consent/fingerprint";
import { statusFor } from "@/modules/privacy/consent-centre";
import { PURPOSES, purposeFor } from "@/modules/privacy/purposes";

const receipt = (version: number, status: "granted" | "withdrawn") => ({
  id: `r${version}${status}`,
  version,
  status,
  source: "settings",
  grantedAt: new Date(0),
  withdrawnAt: status === "withdrawn" ? new Date(1) : null,
});

describe("purpose policies", () => {
  it("covers every consent key exactly once", () => {
    expect(PURPOSES.map((p) => p.key).sort()).toEqual(Object.values(CONSENT_KEYS).sort());
  });

  it("has exactly one core purpose: the Creator Profile, which pauses rather than erases", () => {
    const core = PURPOSES.filter((p) => p.core);
    expect(core.map((p) => p.key)).toEqual(["creator_profile"]);
    expect(core[0]!.erasure).toEqual([]);
  });

  it("only uses known erasure scopes and explains every withdrawal", () => {
    for (const p of PURPOSES) {
      for (const s of p.erasure) expect(ERASURE_SCOPES).toContain(s);
      expect(p.onWithdraw.length).toBeGreaterThan(0);
    }
    expect(purposeFor("social_account_connection")!.erasure).toEqual(["social_account_data", "professional_graph"]);
    expect(purposeFor("nope")).toBeNull();
  });

  it("never describes signals as credit", () => {
    // Only the financial purposes (eligibility, sharing with a lender) may talk about eligibility.
    const copy = PURPOSES.filter((p) => p.key !== "financial_eligibility" && p.key !== "lender_sharing")
      .flatMap((p) => [p.summary, ...p.onWithdraw])
      .join(" ");
    expect(copy).not.toMatch(/credit limit|loan|eligib/i);
    expect(purposeFor("professional_analytics")!.summary).toContain("Not a credit score");
  });
});

describe("consent status", () => {
  it.each([
    [[], 1, "never"],
    [[receipt(1, "granted")], 1, "on"],
    [[receipt(1, "withdrawn")], 1, "off"],
    [[receipt(1, "granted")], 2, "needs_review"],
    [[receipt(2, "granted"), receipt(1, "withdrawn")], 2, "on"],
    [[receipt(1, "granted")], null, "needs_review"],
  ] as const)("%j with current version %s is %s", (receipts, current, expected) => {
    expect(statusFor(receipts, current)).toBe(expected);
  });
});

describe("definition fingerprint", () => {
  const d = { key: "creator_profile", version: 1, title: "T", purpose: "P", body: "B" };
  it("is a stable SHA-256 and changes with any character", () => {
    expect(definitionFingerprint(d)).toMatch(/^[0-9a-f]{64}$/);
    expect(definitionFingerprint(d)).toBe(definitionFingerprint({ ...d }));
    expect(definitionFingerprint({ ...d, body: "B." })).not.toBe(definitionFingerprint(d));
    expect(definitionFingerprint({ ...d, version: 2 })).not.toBe(definitionFingerprint(d));
  });
});
