import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { criterionRequirement, criterionValue } from "@/modules/creator-status/presentation";
import {
  EMPTY_STATUS_INPUTS,
  STATUS_RULES_VERSION,
  TIER_REQUIREMENTS,
  evaluateStatus,
  statusInputsFromFeatures,
  type StatusInputs,
} from "@/modules/creator-status/rules";
import { meetsTier } from "@/modules/creator-status/status";

const onyx: StatusInputs = {
  verifiedLongevityMonths: 30,
  connectedPlatforms: 1,
  totalAudience: 40_000,
  engagementRate3m: 0.025,
  engagementStability: 0.4,
  postingConsistency12m: 0.75,
  followerSpikeDetected: false,
  handleMismatches: 0,
};
const icon: StatusInputs = {
  verifiedLongevityMonths: 60,
  connectedPlatforms: 2,
  totalAudience: 3_00_000,
  engagementRate3m: 0.035,
  engagementStability: 0.8,
  postingConsistency12m: 0.9,
  followerSpikeDetected: false,
  handleMismatches: 0,
};

describe("Creator Status rules", () => {
  it("everyone starts as Member, with every criterion unmeasured or unmet", () => {
    const r = evaluateStatus(EMPTY_STATUS_INPUTS);
    expect(r).toMatchObject({ version: STATUS_RULES_VERSION, tier: "member" });
    expect(r.criteria.every((c) => c.state !== "met")).toBe(true);
    expect(r.criteria.filter((c) => c.tier === "onyx")).toHaveLength(6);
    expect(r.criteria.filter((c) => c.tier === "icon")).toHaveLength(7);
  });

  it("awards the highest tier whose every criterion is met", () => {
    expect(evaluateStatus(onyx).tier).toBe("onyx");
    expect(evaluateStatus(icon).tier).toBe("icon");
  });

  it("reach alone never earns a tier", () => {
    const huge = { ...EMPTY_STATUS_INPUTS, connectedPlatforms: 3, totalAudience: 5_00_00_000 };
    expect(evaluateStatus(huge).tier).toBe("member");
    expect(evaluateStatus({ ...icon, engagementRate3m: 0.001 }).tier).toBe("member");
  });

  it("one unmet or missing criterion holds the tier back — missing is never guessed", () => {
    for (const key of Object.keys(onyx) as (keyof StatusInputs)[]) {
      if (key === "connectedPlatforms" || key === "engagementStability") continue;
      const missing = { ...onyx, [key]: null };
      expect(evaluateStatus(missing).tier, key).toBe("member");
    }
    expect(evaluateStatus({ ...onyx, connectedPlatforms: 0 }).tier).toBe("member");
    expect(evaluateStatus({ ...icon, engagementStability: null }).tier).toBe("onyx");
    expect(evaluateStatus({ ...icon, connectedPlatforms: 1 }).tier).toBe("onyx");
  });

  it("an unusual follower spike or a handle mismatch blocks every tier", () => {
    expect(evaluateStatus({ ...icon, followerSpikeDetected: true }).tier).toBe("member");
    expect(evaluateStatus({ ...icon, handleMismatches: 1 }).tier).toBe("member");
  });

  it("thresholds sit exactly on the boundary (≥)", () => {
    const r = TIER_REQUIREMENTS.onyx;
    const edge: StatusInputs = {
      ...onyx,
      verifiedLongevityMonths: r.longevity,
      totalAudience: r.reach,
      engagementRate3m: r.engagement_quality,
      postingConsistency12m: r.consistency,
    };
    expect(evaluateStatus(edge).tier).toBe("onyx");
    expect(evaluateStatus({ ...edge, verifiedLongevityMonths: r.longevity - 1 }).tier).toBe("member");
  });

  it("reads signals from graph features; self-declared longevity doesn't count", () => {
    const features = [
      { key: "professional_longevity_months", value: 80, source: "declared" },
      { key: "connected_platforms", value: 1, source: "verified" },
      { key: "total_audience", value: 50_000, source: "verified" },
      { key: "follower_spike_detected", value: false, source: "derived" },
    ];
    expect(statusInputsFromFeatures(features)).toMatchObject({
      verifiedLongevityMonths: null,
      connectedPlatforms: 1,
      totalAudience: 50_000,
      followerSpikeDetected: false,
      engagementRate3m: null,
    });
  });

  it("explains each criterion in plain words", () => {
    const [verified, longevity, reach, engagement, consistency] = evaluateStatus(onyx).criteria;
    expect(criterionRequirement(verified!)).toBe("At least one connected account");
    expect(criterionRequirement(longevity!)).toMatch(/24\+ months/);
    expect(criterionValue(reach!)).toBe("40,000");
    expect(criterionValue(engagement!)).toBe("2.5%");
    expect(criterionValue(consistency!)).toBe("9 of 12 months");
    expect(criterionValue(evaluateStatus(EMPTY_STATUS_INPUTS).criteria[1]!)).toBe("Not measured yet");
  });

  it("orders tiers Member < Onyx < Icon", () => {
    expect(meetsTier("icon", "onyx")).toBe(true);
    expect(meetsTier("onyx", "icon")).toBe(false);
    expect(meetsTier("member", "member")).toBe(true);
  });
});

/** Creator Status (and Access/points) must never reach credit decisions (CLAUDE.md §15). */
describe("Status is not creditworthiness", () => {
  const CREDIT_MODULES = ["underwriting", "fraud", "lending", "financial-eligibility", "decisioning", "partners"];
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });

  it("no credit module imports Creator Status, Access or Creator Points", () => {
    const offenders = CREDIT_MODULES.flatMap((m) => files(join("src/modules", m)))
      .filter((f) => /@\/modules\/(creator-status|access|rewards)\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });

  it("the underwriting engine has no status input", () => {
    const model = readFileSync("src/modules/underwriting/model.ts", "utf8");
    expect(model).not.toMatch(/tier|creator_status|onyx|icon/i);
  });
});
