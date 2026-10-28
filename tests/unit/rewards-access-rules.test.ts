import { describe, expect, it } from "vitest";

import {
  isOpportunityOpen,
  requestEligibility,
  requestExpiresAt,
  type RequestEligibilityInput,
} from "@/modules/access/domain";
import {
  MILESTONE_POINTS,
  POINTS_RULES_VERSION,
  formatPoints,
  isValidEntry,
  milestonesDue,
  pointsBalance,
  type PointsMilestone,
} from "@/modules/rewards/domain";

const none = new Set<PointsMilestone>();

describe(`Creator Points rules ${POINTS_RULES_VERSION}`, () => {
  it("grants the documented one-off amounts", () => {
    expect(MILESTONE_POINTS).toEqual({ welcome: 500, verified_mobile: 100, tier_onyx: 1_000, tier_icon: 2_500 });
  });

  it("grants each milestone once, from facts only", () => {
    expect(milestonesDue({ profileCompleted: false, mobileVerified: false, tier: "member" }, none)).toEqual([]);
    expect(milestonesDue({ profileCompleted: true, mobileVerified: true, tier: "member" }, none)).toEqual([
      "welcome",
      "verified_mobile",
    ]);
    expect(milestonesDue({ profileCompleted: true, mobileVerified: true, tier: "onyx" }, new Set(["welcome"]))).toEqual(
      ["verified_mobile", "tier_onyx"],
    );
  });

  it("reaching Icon directly also grants Onyx; dropping a tier takes nothing back", () => {
    expect(
      milestonesDue({ profileCompleted: true, mobileVerified: false, tier: "icon" }, new Set(["welcome"])),
    ).toEqual(["tier_onyx", "tier_icon"]);
    const earned = new Set<PointsMilestone>(["welcome", "tier_onyx", "tier_icon"]);
    expect(milestonesDue({ profileCompleted: true, mobileVerified: false, tier: "member" }, earned)).toEqual([]);
  });

  it("validates signed entries and sums the balance", () => {
    expect(isValidEntry({ entryType: "earn", amount: 500 })).toBe(true);
    expect(isValidEntry({ entryType: "hold", amount: -300 })).toBe(true);
    expect(isValidEntry({ entryType: "release", amount: 300 })).toBe(true);
    expect(isValidEntry({ entryType: "hold", amount: 300 })).toBe(false);
    expect(isValidEntry({ entryType: "earn", amount: 0 })).toBe(false);
    expect(isValidEntry({ entryType: "earn", amount: 1.5 })).toBe(false);
    expect(
      pointsBalance([
        { entryType: "earn", amount: 500 },
        { entryType: "hold", amount: -300 },
        { entryType: "release", amount: 300 },
        { entryType: "hold", amount: -200 },
      ]),
    ).toBe(300);
  });

  it("never formats points as money", () => {
    expect(formatPoints(2500)).toBe("2,500 points");
    expect(formatPoints(1)).toBe("1 point");
    expect(formatPoints(100000)).not.toMatch(/₹|rs|inr/i);
  });
});

describe("Access request rules", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const base: RequestEligibilityInput = {
    opportunity: {
      status: "open",
      opensAt: new Date("2026-10-01T00:00:00Z"),
      closesAt: new Date("2026-11-01T00:00:00Z"),
      minTier: "onyx",
      pointsCost: 400,
      places: 3,
    },
    tier: "onyx",
    balance: 500,
    approvedCount: 2,
    hasActiveRequest: false,
    now,
  };
  const refusal = (patch: Partial<RequestEligibilityInput>) => {
    const r = requestEligibility({ ...base, ...patch });
    return r.ok ? "ok" : r.reason;
  };

  it("allows an eligible request", () => {
    expect(refusal({})).toBe("ok");
    expect(refusal({ tier: "icon", balance: 400 })).toBe("ok");
  });

  it("refuses for the first reason that applies", () => {
    expect(refusal({ opportunity: { ...base.opportunity, status: "closed" } })).toBe("not_open");
    expect(refusal({ now: new Date("2026-09-30T00:00:00Z") })).toBe("not_open");
    expect(refusal({ now: base.opportunity.closesAt })).toBe("not_open");
    expect(refusal({ hasActiveRequest: true })).toBe("already_requested");
    expect(refusal({ tier: "member" })).toBe("tier_required");
    expect(refusal({ approvedCount: 3 })).toBe("full");
    expect(refusal({ balance: 399 })).toBe("insufficient_points");
  });

  it("expires an undecided request after 14 days or at closing, whichever is first", () => {
    expect(requestExpiresAt(now, base.opportunity.closesAt)).toEqual(new Date("2026-10-24T10:00:00Z"));
    expect(requestExpiresAt(now, new Date("2026-10-12T00:00:00Z"))).toEqual(new Date("2026-10-12T00:00:00Z"));
  });

  it("an opportunity is open only inside its window", () => {
    expect(isOpportunityOpen(base.opportunity, now)).toBe(true);
    expect(isOpportunityOpen({ ...base.opportunity, status: "closed" }, now)).toBe(false);
  });
});
