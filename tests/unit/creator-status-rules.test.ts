import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CREATOR_STATUS_RULES_VERSION,
  STATUS_THRESHOLDS,
  evaluateCreatorStatus,
  type StatusSignals,
} from "@/modules/creator-status/rules";
import { tierAtLeast } from "@/modules/creator-status/status";

const v = (value: number | boolean | null, source = "derived") => ({ value, source });

/** Comfortably meets every Onyx criterion and none of the Icon-only ones. */
const onyx: StatusSignals = {
  connected_platforms: v(1, "verified"),
  professional_longevity_months: v(30, "verified"),
  total_audience: v(40_000, "verified"),
  engagement_rate_3m: v(0.025, "verified"),
  posting_consistency_12m: v(0.7),
  engagement_stability: v(0.5),
  follower_spike_detected: v(false),
  handle_mismatches: v(0),
};

const icon: StatusSignals = {
  ...onyx,
  connected_platforms: v(2, "verified"),
  professional_longevity_months: v(60, "verified"),
  total_audience: v(300_000, "verified"),
  engagement_rate_3m: v(0.035, "verified"),
  posting_consistency_12m: v(0.8),
  engagement_stability: v(0.75),
};

const unmet = (signals: StatusSignals, tier: "onyx" | "icon") =>
  evaluateCreatorStatus(signals)
    .checklists.find((c) => c.tier === tier)!
    .criteria.filter((c) => !c.met)
    .map((c) => c.criterion);

describe(`Creator Status rules ${CREATOR_STATUS_RULES_VERSION}`, () => {
  it("earns Onyx and Icon only when every criterion is met", () => {
    expect(evaluateCreatorStatus(onyx).tier).toBe("onyx");
    expect(evaluateCreatorStatus(icon).tier).toBe("icon");
    expect(unmet(onyx, "icon")).toEqual([
      "verified_activity",
      "verified_longevity",
      "reach",
      "engagement_quality",
      "posting_consistency",
      "steady_engagement",
    ]);
  });

  it("uses the documented thresholds", () => {
    expect(STATUS_THRESHOLDS.onyx).toMatchObject({
      platforms: 1,
      longevityMonths: 24,
      audience: 25_000,
      engagementRate: 0.02,
      postingConsistency: 0.6,
      engagementStability: null,
    });
    expect(STATUS_THRESHOLDS.icon).toMatchObject({
      platforms: 2,
      longevityMonths: 48,
      audience: 250_000,
      engagementRate: 0.03,
      postingConsistency: 0.75,
      engagementStability: 0.7,
    });
    // Thresholds are inclusive.
    const edge: StatusSignals = {
      ...onyx,
      professional_longevity_months: v(24, "verified"),
      total_audience: v(25_000),
      engagement_rate_3m: v(0.02),
      posting_consistency_12m: v(0.6),
    };
    expect(evaluateCreatorStatus(edge).tier).toBe("onyx");
  });

  it("reach alone never earns a tier", () => {
    const reachOnly: StatusSignals = { total_audience: v(5_000_000, "verified") };
    const r = evaluateCreatorStatus(reachOnly);
    expect(r.tier).toBe("member");
    expect(unmet(reachOnly, "onyx")).not.toContain("reach");
    expect(evaluateCreatorStatus({ ...onyx, engagement_rate_3m: v(0.001) }).tier).toBe("member");
  });

  it("treats a missing signal as not met — never guessed", () => {
    expect(evaluateCreatorStatus({}).tier).toBe("member");
    for (const key of Object.keys(onyx)) {
      const withoutOne = { ...onyx, [key]: v(null) };
      if (key === "engagement_stability") continue; // not an Onyx criterion
      expect(evaluateCreatorStatus(withoutOne).tier, key).toBe("member");
    }
    const r = evaluateCreatorStatus({});
    expect(r.checklists[0]!.criteria.every((c) => !c.met)).toBe(true);
    expect(r.checklists[0]!.criteria.find((c) => c.criterion === "reach")).toMatchObject({
      value: null,
      threshold: 25_000,
    });
  });

  it("counts longevity only when verified from connected accounts", () => {
    expect(evaluateCreatorStatus({ ...onyx, professional_longevity_months: v(120, "declared") }).tier).toBe("member");
  });

  it("requires authenticity: no follower spike and no handle mismatch", () => {
    expect(evaluateCreatorStatus({ ...icon, follower_spike_detected: v(true) }).tier).toBe("member");
    expect(evaluateCreatorStatus({ ...icon, handle_mismatches: v(1) }).tier).toBe("member");
    expect(evaluateCreatorStatus({ ...icon, follower_spike_detected: v(null) }).tier).toBe("member");
  });

  it("Icon needs steady engagement on top of the higher bars", () => {
    expect(evaluateCreatorStatus({ ...icon, engagement_stability: v(0.69) }).tier).toBe("onyx");
  });

  it("is deterministic", () => {
    expect(evaluateCreatorStatus(icon)).toEqual(evaluateCreatorStatus(structuredClone(icon)));
  });

  it("compares tiers", () => {
    expect(tierAtLeast("icon", "onyx")).toBe(true);
    expect(tierAtLeast("onyx", "onyx")).toBe(true);
    expect(tierAtLeast("member", "onyx")).toBe(false);
  });
});

/** Every import specifier in a source tree. */
function importsIn(dir: string): { file: string; spec: string }[] {
  const out: { file: string; spec: string }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...importsIn(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const src = readFileSync(path, "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) out.push({ file: path, spec: m[1]! });
  }
  return out;
}

describe("Creator Status, Access and Creator Points stay out of credit", () => {
  const CREDIT_MODULES = ["underwriting", "lending", "financial-eligibility", "fraud", "decisioning"];
  const FORBIDDEN =
    /(modules\/(creator-status|access|rewards)\b|creator_status_runs|creator_points_ledger|access_requests)/;

  it("no credit module imports them", () => {
    const offenders = CREDIT_MODULES.flatMap((m) => importsIn(join("src/modules", m))).filter((i) =>
      FORBIDDEN.test(i.spec),
    );
    expect(offenders).toEqual([]);
  });

  it("no credit module reads their tables", () => {
    const tables = ["creatorStatusRuns", "creatorPointsLedger", "accessRequests", "accessOpportunities"];
    const offenders: string[] = [];
    for (const m of CREDIT_MODULES) {
      for (const { file } of importsIn(join("src/modules", m))) {
        const src = readFileSync(file, "utf8");
        if (tables.some((t) => new RegExp(`\\b${t}\\b`).test(src))) offenders.push(file);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
