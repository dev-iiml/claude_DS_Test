import { afterEach, describe, expect, it, vi } from "vitest";

import { RATE_LIMITS, effectiveLimit, windowFor } from "@/modules/rate-limit/rules";
import { rateLimitMultiplier, rateLimitSubjectKey } from "@/modules/rate-limit/subject-key";

describe("rate-limit rules", () => {
  it("fixed windows align to the window size", () => {
    const now = new Date("2026-10-30T10:07:30Z");
    expect(windowFor({ windowSeconds: 600 }, now)).toEqual({
      windowStart: new Date("2026-10-30T10:00:00Z"),
      retryAfterSeconds: 150,
    });
    expect(windowFor({ windowSeconds: 3600 }, now).windowStart).toEqual(new Date("2026-10-30T10:00:00Z"));
  });

  it("every bucket is well formed and none outlives the 48h retention", () => {
    for (const [bucket, rule] of Object.entries(RATE_LIMITS)) {
      expect(bucket).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowSeconds).toBeLessThanOrEqual(24 * 3600);
    }
  });

  it("the multiplier loosens limits but never below one", () => {
    expect(effectiveLimit({ limit: 10 }, 50)).toBe(500);
    expect(effectiveLimit({ limit: 10 }, 0.01)).toBe(1);
  });
});

describe("rate-limit subject keys", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("hashes subjects: no raw IP, stable, separated by subject type", () => {
    const k = rateLimitSubjectKey("ip", "203.0.113.7");
    expect(k).toMatch(/^rl1:[0-9a-f]{32}$/);
    expect(k).not.toContain("203");
    expect(rateLimitSubjectKey("ip", "203.0.113.7")).toBe(k);
    expect(rateLimitSubjectKey("user", "203.0.113.7")).not.toBe(k);
  });

  it("requires a key and ignores the multiplier outside development/test", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("RATE_LIMIT_KEY", "");
    vi.stubEnv("RATE_LIMIT_MULTIPLIER", "50");
    expect(() => rateLimitSubjectKey("ip", "203.0.113.7")).toThrow(/RATE_LIMIT_KEY/);
    expect(rateLimitMultiplier()).toBe(1);
    vi.stubEnv("APP_ENV", "test");
    expect(rateLimitMultiplier()).toBe(50);
  });
});

describe("bureau check limit", () => {
  it("can be raised for development/test only", async () => {
    const { bureauChecksPer30Days } = await import("@/modules/financial-eligibility/domain");
    expect(bureauChecksPer30Days({ APP_ENV: "development" })).toBe(3);
    expect(bureauChecksPer30Days({ APP_ENV: "development", DEV_BUREAU_CHECKS_PER_30_DAYS: "50" })).toBe(50);
    expect(bureauChecksPer30Days({ APP_ENV: "test", DEV_BUREAU_CHECKS_PER_30_DAYS: "500" })).toBe(3);
    expect(bureauChecksPer30Days({ APP_ENV: "production", DEV_BUREAU_CHECKS_PER_30_DAYS: "50" })).toBe(3);
    expect(bureauChecksPer30Days({ APP_ENV: "staging", DEV_BUREAU_CHECKS_PER_30_DAYS: "50" })).toBe(3);
  });
});
