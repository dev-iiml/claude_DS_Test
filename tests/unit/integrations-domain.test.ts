import { describe, expect, it } from "vitest";

import {
  CLOSED_CIRCUIT,
  SECRET_REF_PATTERN,
  effectiveCircuitState,
  nextCircuit,
  requiresApproval,
  selectRoute,
  type RoutableConfig,
} from "@/modules/integrations/domain";
import { describeJobError, retryDelayMs, scheduleWindowKey, JOB_SCHEDULES } from "@/modules/jobs/domain";

const now = new Date("2026-10-03T10:00:00Z");
const policy = { failureThreshold: 3, cooldownMs: 60_000 };

const config = (id: string, over: Partial<RoutableConfig> = {}): RoutableConfig => ({
  id,
  kind: "bureau",
  key: id,
  adapter: "mock",
  mode: "mock",
  enabled: true,
  misconfigured: false,
  circuit: CLOSED_CIRCUIT,
  ...over,
});
const route = { kind: "bureau" as const, primaryConfigId: "a", fallbackConfigId: "b", paused: false };
const ctx = { now, production: false, policy };

describe("circuit breaker", () => {
  it("opens after the threshold of consecutive failures and resets on success", () => {
    let c = CLOSED_CIRCUIT;
    c = nextCircuit(c, "failure", now, policy);
    c = nextCircuit(c, "failure", now, policy);
    expect(c.state).toBe("closed");
    c = nextCircuit(c, "failure", now, policy);
    expect(c).toEqual({ state: "open", consecutiveFailures: 3, openedAt: now });
    expect(nextCircuit(c, "success", now, policy)).toEqual(CLOSED_CIRCUIT);
  });

  it("becomes half-open after the cooldown; a failed probe re-opens it for a full cooldown", () => {
    const open = { state: "open" as const, consecutiveFailures: 3, openedAt: now };
    expect(effectiveCircuitState(open, new Date(now.getTime() + 59_999), policy)).toBe("open");
    const later = new Date(now.getTime() + 60_000);
    expect(effectiveCircuitState(open, later, policy)).toBe("half_open");
    expect(nextCircuit(open, "failure", later, policy)).toMatchObject({ state: "open", openedAt: later });
  });
});

describe("route selection", () => {
  const configs = (a: Partial<RoutableConfig> = {}, b: Partial<RoutableConfig> = {}) =>
    new Map([
      ["a", config("a", a)],
      ["b", config("b", b)],
    ]);

  it("serves from the primary when healthy", () => {
    expect(selectRoute(route, configs(), ctx)).toMatchObject({ status: "ok", via: "primary" });
  });

  it("uses the fallback while the primary is open, disabled or misconfigured", () => {
    const open = { circuit: { state: "open" as const, consecutiveFailures: 3, openedAt: now } };
    expect(selectRoute(route, configs(open), ctx)).toMatchObject({ via: "fallback" });
    expect(selectRoute(route, configs({ enabled: false }), ctx)).toMatchObject({ via: "fallback" });
    expect(selectRoute(route, configs({ misconfigured: true }), ctx)).toMatchObject({ via: "fallback" });
  });

  it("is unavailable when neither can serve, paused by the kill switch, or not configured", () => {
    expect(selectRoute(route, configs({ enabled: false }, { enabled: false }), ctx)).toEqual({
      status: "unavailable",
      reason: "disabled",
    });
    expect(selectRoute({ ...route, paused: true }, configs(), ctx)).toEqual({ status: "paused" });
    expect(selectRoute(undefined, configs(), ctx)).toEqual({ status: "not_configured" });
  });

  it("never routes production traffic to a mock", () => {
    expect(selectRoute(route, configs({}, { mode: "live" }), { ...ctx, production: true })).toMatchObject({
      via: "fallback",
    });
    expect(selectRoute(route, configs(), { ...ctx, production: true })).toEqual({
      status: "unavailable",
      reason: "mock_in_production",
    });
  });
});

describe("approval policy (risky changes only)", () => {
  it("kill switch is instant; lifting it and route changes need approval", () => {
    expect(requiresApproval({ action: "pause_kind" })).toBe(false);
    expect(requiresApproval({ action: "resume_kind" })).toBe(true);
    expect(requiresApproval({ action: "set_route" })).toBe(true);
  });

  it("unrouted mock configs apply at once; sandbox/live or routed configs need approval", () => {
    expect(requiresApproval({ action: "create_config", targetMode: "mock" })).toBe(false);
    expect(requiresApproval({ action: "create_config", targetMode: "sandbox" })).toBe(true);
    expect(requiresApproval({ action: "update_config", currentMode: "mock", configIsRouted: false })).toBe(false);
    expect(requiresApproval({ action: "update_config", currentMode: "mock", configIsRouted: true })).toBe(true);
    expect(requiresApproval({ action: "update_config", currentMode: "mock", targetMode: "live" })).toBe(true);
    expect(requiresApproval({ action: "update_config", currentMode: "live" })).toBe(true);
  });

  it("secret references must be INTEGRATION_ env var names", () => {
    expect(SECRET_REF_PATTERN.test("INTEGRATION_BUREAU_A_KEY")).toBe(true);
    for (const bad of ["DATABASE_URL", "CRON_SECRET", "integration_x", "INTEGRATION_", "sk_live_123"]) {
      expect(SECRET_REF_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe("job policy", () => {
  it("backs off exponentially with a cap", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });

  it("dedupes schedules per window", () => {
    const health = JOB_SCHEDULES.find((s) => s.type === "provider_health_check")!;
    expect(scheduleWindowKey(health, new Date("2026-10-03T10:04:59Z"))).toBe(
      "provider_health_check:2026-10-03T10:00:00.000Z",
    );
    expect(scheduleWindowKey(health, new Date("2026-10-03T10:05:00Z"))).toBe(
      "provider_health_check:2026-10-03T10:05:00.000Z",
    );
  });

  it("keeps query parameters out of stored errors", () => {
    const e = new Error("Failed query: select * from x where id = $1 params: 9876543210", {
      cause: new Error('relation "x" does not exist'),
    });
    expect(describeJobError(e)).toBe('Error: relation "x" does not exist');
    expect(describeJobError(new Error("boom params: secret"))).toBe("Error: boom");
  });
});
