import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  CLIENT_EVENTS,
  FORBIDDEN_PROP_KEYS,
  FUNNEL_STEPS,
  parseEventProps,
} from "@/modules/analytics/events";
import { retentionCutoffDay } from "@/modules/analytics/maintenance";
import { analyticsSubject } from "@/modules/analytics/pseudonym";
import { analyticsDay } from "@/modules/analytics/recorder";
import { MIN_CELL, formatSuppressed, suppress } from "@/modules/analytics/suppression";

/** CLAUDE.md §26 — every funnel event must exist. */
const SECTION_26 = [
  "landing_viewed",
  "application_started",
  "account_created",
  "creator_profile_completed",
  "social_connection_started",
  "social_connection_completed",
  "passport_generated",
  "status_generated",
  "financial_eligibility_started",
  "financial_consent_granted",
  "financial_inputs_completed",
  "underwriting_started",
  "underwriting_completed",
  "offer_generated",
  "offer_viewed",
  "simulated_offer_accepted",
  "access_opportunity_viewed",
  "access_requested",
];

describe("analytics event catalogue", () => {
  it("covers every §26 funnel event", () => {
    expect(ANALYTICS_EVENT_NAMES).toEqual(expect.arrayContaining(SECTION_26));
    for (const s of FUNNEL_STEPS) expect(ANALYTICS_EVENTS[s.event].subject).toBe("user");
  });

  it("no event property could carry personal or financial data", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const shape = (ANALYTICS_EVENTS[name].props as unknown as { shape: Record<string, unknown> }).shape;
      for (const key of Object.keys(shape)) expect(key, `${name}.${key}`).not.toMatch(FORBIDDEN_PROP_KEYS);
    }
  });

  it("schemas are strict: unknown keys, free text and wrong enums are rejected", () => {
    expect(() => parseEventProps("account_created", { client: "web", email: "x@y.z" })).toThrow();
    expect(() => parseEventProps("social_connection_started", { platform: "Instagram Handle!" })).toThrow();
    expect(() => parseEventProps("status_generated", { tier: "platinum", changed: true })).toThrow();
    expect(() => parseEventProps("offer_generated", { simulated: true, amount: 100000 })).toThrow();
    expect(parseEventProps("access_requested", { kind: "pr_drop", min_tier: "member" })).toEqual({
      kind: "pr_drop",
      min_tier: "member",
    });
  });

  it("views are optional (consent-based); funnel steps are essential; only views and anonymous events come from clients", () => {
    expect(ANALYTICS_EVENTS.offer_viewed.tier).toBe("optional");
    expect(ANALYTICS_EVENTS.access_opportunity_viewed.tier).toBe("optional");
    expect(ANALYTICS_EVENTS.account_created.tier).toBe("essential");
    expect(CLIENT_EVENTS.sort()).toEqual(
      ["access_opportunity_viewed", "application_started", "landing_viewed", "offer_viewed"].sort(),
    );
  });
});

describe("pseudonyms, days, retention, suppression", () => {
  it("pseudonyms are keyed, stable, versioned and reveal nothing", () => {
    const a = analyticsSubject("11111111-1111-4111-8111-111111111111");
    expect(a).toMatch(/^a1:[0-9a-f]{32}$/);
    expect(analyticsSubject("11111111-1111-4111-8111-111111111111")).toBe(a);
    expect(analyticsSubject("22222222-2222-4222-8222-222222222222")).not.toBe(a);
    expect(a).not.toContain("1111");
  });

  it("days are India time and raw events are kept 24 months", () => {
    expect(analyticsDay(new Date("2026-10-28T19:00:00.000Z"))).toBe("2026-10-29");
    expect(analyticsDay(new Date("2026-10-28T18:00:00.000Z"))).toBe("2026-10-28");
    expect(retentionCutoffDay(new Date("2026-10-28T06:00:00.000Z"))).toBe("2024-10-28");
  });

  it("hides counts below the small-cell threshold", () => {
    expect(MIN_CELL).toBe(5);
    expect(suppress(0)).toEqual({ value: 0, suppressed: false });
    expect(suppress(4)).toEqual({ value: null, suppressed: true });
    expect(suppress(5)).toEqual({ value: 5, suppressed: false });
    expect(formatSuppressed(suppress(3))).toBe("<5");
    expect(formatSuppressed(suppress(1200))).toBe("1,200");
  });
});

describe("analytics stays out of the regulated domain", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });

  it("the analytics module never imports financial modules or reads the fin schema", () => {
    for (const f of files("src/modules/analytics")) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/@\/modules\/(financial-eligibility|underwriting|lending|fraud|partners)\b/);
      expect(src, f).not.toMatch(/\bfin\.[a-z]|creditApplications|underwritingRuns|fraudChecks/);
    }
  });
});
