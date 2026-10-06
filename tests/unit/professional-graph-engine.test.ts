import { describe, expect, it } from "vitest";

import {
  ENGINE_VERSION,
  FEATURE_VERSIONS,
  computeFeatures,
  type AccountInput,
  type EngineInput,
  type FeatureKey,
} from "@/modules/professional-graph/engine";
import { hashInputs } from "@/modules/professional-graph/inputs-hash";
import { FEATURE_COPY, formatFeatureValue } from "@/modules/professional-graph/presentation";

const AS_OF = "2026-10-01T00:00:00.000Z";

/** 12 monthly snapshots ending Oct 2026 with steady 2% growth and a post every month. */
function account(over: Partial<AccountInput> = {}, opts: { start?: number; growth?: number; spikeAt?: number } = {}) {
  const snapshots = [];
  let audience = opts.start ?? 10_000;
  for (let i = 0; i < 12; i++) {
    audience = Math.round(audience * (1 + (opts.growth ?? 0.02)));
    if (opts.spikeAt === i) audience = Math.round(audience * 1.8);
    snapshots.push({
      capturedAt: new Date(Date.UTC(2025, 10 + i, 1)).toISOString(),
      audience,
      engagementRate: 0.04,
      postsCount: 100 + i * 5,
    });
  }
  return {
    platform: "instagram",
    handle: "aarohi.test",
    declaredHandle: "aarohi.test",
    accountCreatedAt: "2021-04-10T00:00:00.000Z",
    snapshots,
    ...over,
  } satisfies AccountInput;
}

function input(over: Partial<EngineInput> = {}): EngineInput {
  return { asOf: AS_OF, creatorSince: "2020-01-01", declaredPlatforms: ["instagram"], accounts: [account()], ...over };
}

const byKey = (inp: EngineInput) => Object.fromEntries(computeFeatures(inp).map((f) => [f.key, f]));

describe("Professional Graph engine", () => {
  it("emits every feature exactly once with its version", () => {
    const features = computeFeatures(input());
    expect(features.map((f) => f.key).sort()).toEqual(Object.keys(FEATURE_VERSIONS).sort());
    for (const f of features) expect(f.version).toBe(FEATURE_VERSIONS[f.key]);
  });

  it("is deterministic: same input, identical output", () => {
    expect(JSON.stringify(computeFeatures(input()))).toBe(JSON.stringify(computeFeatures(input())));
  });

  it("derives verified longevity from the oldest connected account", () => {
    const f = byKey(input());
    expect(f.professional_longevity_months).toMatchObject({ value: 66, source: "verified", confidence: "high" });
  });

  it("falls back to self-declared longevity with low confidence when nothing is connected", () => {
    const f = byKey(input({ accounts: [] }));
    expect(f.professional_longevity_months).toMatchObject({ value: 81, source: "declared", confidence: "low" });
    expect(f.total_audience!.value).toBeNull();
    expect(f.follower_spike_detected!.value).toBeNull();
    expect(f.declared_not_connected!.value).toBe(1);
  });

  it("measures platform concentration (HHI): one platform is fully concentrated, two equal ones are 0.5", () => {
    expect(byKey(input()).platform_concentration!.value).toBe(1);
    const two = input({
      accounts: [account(), account({ platform: "youtube", handle: "aarohi.tv", declaredHandle: null })],
    });
    expect(byKey(two).platform_concentration!.value).toBe(0.5);
  });

  it("counts a platform once and sums its accounts for concentration (several accounts per platform)", () => {
    const sameTwice = input({
      accounts: [account(), account({ handle: "aarohi.eats", declaredHandle: null })],
    });
    const f = byKey(sameTwice);
    expect(f.connected_platforms!.value).toBe(1);
    expect(f.connected_platforms!.provenance).toMatchObject({ accounts: 2 });
    expect(f.platform_concentration!.value).toBe(1);
    // An extra account without its own declaration is not a handle mismatch.
    expect(f.handle_mismatches!.value).toBe(0);
    const mixed = input({
      accounts: [
        account(),
        account({ handle: "aarohi.eats", declaredHandle: null }),
        account({ platform: "youtube", handle: "aarohi.tv", declaredHandle: null }, { start: 20_000 }),
      ],
    });
    // Instagram (two equal accounts) and YouTube (one double-size account) are an even split.
    expect(byKey(mixed).platform_concentration!.value).toBe(0.5);
  });

  it("computes 6-month growth and treats even growth as stable", () => {
    const f = byKey(input());
    expect(f.audience_growth_6m!.value).toBeCloseTo(12.62, 1);
    expect(f.growth_stability!.value as number).toBeGreaterThan(0.75);
    expect(f.posting_consistency_12m!.value).toBe(1);
    expect(f.engagement_rate_3m!.value).toBeCloseTo(0.04, 6);
    expect(f.engagement_stability!.value).toBe(1);
  });

  it("returns null with partial completeness when history is too short", () => {
    const short = account();
    short.snapshots = short.snapshots.slice(-3);
    const f = byKey(input({ accounts: [short] }));
    expect(f.audience_growth_6m).toMatchObject({ value: null, confidence: "low" });
    expect(f.audience_growth_6m!.completeness).toBeCloseTo(3 / 7, 3);
    expect(f.growth_stability!.value).toBeNull();
  });

  it("flags a month-over-month follower jump above 50%", () => {
    expect(byKey(input()).follower_spike_detected!.value).toBe(false);
    const f = byKey(input({ accounts: [account({}, { spikeAt: 8 })] }));
    expect(f.follower_spike_detected).toMatchObject({ value: true, provenance: { platforms: ["instagram"] } });
  });

  it("ignores jumps on a tiny base (< 1,000)", () => {
    expect(byKey(input({ accounts: [account({}, { start: 300, spikeAt: 5 })] })).follower_spike_detected!.value).toBe(
      false,
    );
  });

  it("counts declared-but-unconnected platforms and handle mismatches (case-insensitive)", () => {
    const f = byKey(
      input({
        declaredPlatforms: ["instagram", "youtube", "linkedin"],
        accounts: [account({ handle: "Aarohi.Test", declaredHandle: "aarohi.test" })],
      }),
    );
    expect(f.declared_not_connected).toMatchObject({ value: 2, provenance: { platforms: ["linkedin", "youtube"] } });
    expect(f.handle_mismatches!.value).toBe(0);
    const g = byKey(input({ accounts: [account({ handle: "someone.else" })] }));
    expect(g.handle_mismatches).toMatchObject({ value: 1, provenance: { platforms: ["instagram"] } });
  });

  it("never emits a credit-like feature", () => {
    const keys = Object.keys(FEATURE_VERSIONS).join(" ");
    expect(keys).not.toMatch(/credit|limit|score|income|loan|default/);
  });
});

describe("inputs hash", () => {
  it("is independent of ordering and sensitive to data changes", () => {
    const a = input({ declaredPlatforms: ["youtube", "instagram"] });
    const b = input({ declaredPlatforms: ["instagram", "youtube"] });
    b.accounts[0]!.snapshots.reverse();
    expect(hashInputs(a)).toBe(hashInputs(b));
    expect(hashInputs(a)).toMatch(/^[0-9a-f]{64}$/);

    const c = input();
    c.accounts[0]!.snapshots[3]!.audience! += 1;
    expect(hashInputs(c)).not.toBe(hashInputs(input()));
    expect(hashInputs(input({ asOf: "2026-10-02T00:00:00.000Z" }))).not.toBe(hashInputs(input()));
  });

  it("is versioned by the engine", () => {
    expect(ENGINE_VERSION).toMatch(/^pg-\d+\.\d+\.\d+$/);
  });
});

describe("presentation", () => {
  it("has creator-facing copy for every feature", () => {
    for (const key of Object.keys(FEATURE_VERSIONS) as FeatureKey[]) expect(FEATURE_COPY[key].label).toBeTruthy();
  });

  it.each([
    ["professional_longevity_months", 65, "5 yr 5 mo"],
    ["professional_longevity_months", 24, "2 years"],
    ["professional_longevity_months", 1, "1 month"],
    ["total_audience", 128_400, "1.3L"],
    ["audience_growth_6m", 12.6, "+12.6%"],
    ["audience_growth_6m", -3, "-3.0%"],
    ["engagement_rate_3m", 0.0412, "4.1%"],
    ["platform_concentration", 1, "Concentrated"],
    ["platform_concentration", 0.5, "Balanced"],
    ["platform_concentration", 0.3, "Diversified"],
    ["growth_stability", 0.9, "Very steady"],
    ["posting_consistency_12m", 0.75, "75% of months"],
    ["follower_spike_detected", false, "None"],
    ["declared_not_connected", null, "Not enough data yet"],
  ] as const)("formats %s=%s as %s", (key, value, expected) => {
    expect(formatFeatureValue(key, value)).toBe(expected);
  });
});
