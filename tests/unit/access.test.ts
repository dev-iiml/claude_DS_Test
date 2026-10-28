import { describe, expect, it } from "vitest";

import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import { CONSENT_KEYS } from "@/modules/consent/domain";
import { accessDecisionSchema, opportunityInputSchema, requestNoteSchema } from "@/modules/access/schemas";
import { tierRequirementLabel } from "@/modules/access/presentation";
import { purposeFor } from "@/modules/privacy/purposes";
import { EARN_RULES, EARN_RULE_CODES, POINTS_RULES_VERSION, formatPoints } from "@/modules/rewards/rules";

const valid = {
  brandId: "11111111-1111-4111-8111-111111111111",
  title: "Luxury Beauty Drop",
  kind: "pr_drop",
  category: "Beauty",
  summary: "A curated box.",
  details: "Before launch.",
  minTier: "member",
  pointsCost: "300",
  seats: "25",
  opensAt: "2026-10-01T10:00:00+05:30",
  closesAt: "2026-11-01T10:00:00+05:30",
  status: "live",
};

describe("Creator Points rules", () => {
  it("are versioned membership milestones and tiers — nothing credit- or consent-related", () => {
    expect(POINTS_RULES_VERSION).toBe("pts-0.1.0");
    expect(EARN_RULE_CODES.sort()).toEqual(["mobile_verified", "tier_icon", "tier_onyx", "welcome"]);
    for (const code of EARN_RULE_CODES) {
      expect(code).not.toMatch(/loan|credit|offer|eligib|borrow|consent|connect/);
      expect(EARN_RULES[code].points).toBeGreaterThan(0);
    }
  });

  it("are never shown as money", () => {
    expect(formatPoints(1500)).toBe("1,500 points");
    expect(formatPoints(1)).toBe("1 point");
    expect(formatPoints(100000)).toBe("1,00,000 points");
    expect(formatPoints(100)).not.toMatch(/₹|rs|inr/i);
  });
});

describe("Access schemas", () => {
  it("accepts a valid opportunity and rejects a window that closes before it opens", () => {
    expect(opportunityInputSchema.safeParse(valid).success).toBe(true);
    expect(opportunityInputSchema.safeParse({ ...valid, closesAt: valid.opensAt }).success).toBe(false);
    expect(opportunityInputSchema.safeParse({ ...valid, pointsCost: "-1" }).success).toBe(false);
    expect(opportunityInputSchema.safeParse({ ...valid, seats: "0" }).success).toBe(false);
    expect(opportunityInputSchema.safeParse({ ...valid, minTier: "platinum" }).success).toBe(false);
    expect(opportunityInputSchema.safeParse({ ...valid, isSample: false }).success).toBe(false);
  });

  it("decline needs a reason; notes are short and optional", () => {
    expect(accessDecisionSchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(accessDecisionSchema.safeParse({ decision: "decline" }).success).toBe(false);
    expect(accessDecisionSchema.safeParse({ decision: "decline", reason: "no_seats" }).success).toBe(true);
    expect(requestNoteSchema.parse("   ")).toBeNull();
    expect(requestNoteSchema.safeParse("x".repeat(281)).success).toBe(false);
  });

  it("labels who can request", () => {
    expect(tierRequirementLabel("member")).toBe("All members");
    expect(tierRequirementLabel("onyx")).toBe("Onyx and above");
    expect(tierRequirementLabel("icon")).toBe("Icon");
  });
});

describe("Brand opportunities consent", () => {
  it("is its own purpose: versioned, says nothing reaches a brand in the preview, and erases requests", () => {
    const seed = CONSENT_DEFINITION_SEEDS.find((d) => d.key === CONSENT_KEYS.brandOpportunities)!;
    expect(seed).toMatchObject({ version: 1, title: "Brand opportunities" });
    expect(seed.body).toMatch(/nothing is sent to any brand/);
    expect(seed.body).toMatch(/never includes your financial information/);
    expect(purposeFor(CONSENT_KEYS.brandOpportunities)).toMatchObject({ core: false, erasure: ["access_requests"] });
  });
});
