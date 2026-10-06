import { describe, expect, it } from "vitest";

import { hasValidConsentFor, isDefinitionActive, selectActiveDefinition } from "@/modules/consent/rules";

const d = (id: string, version: number, from: string, to: string | null = null) => ({
  id,
  key: "creator_profile",
  version,
  activeFrom: new Date(from),
  activeTo: to ? new Date(to) : null,
});

describe("consent definition windows", () => {
  const v1 = d("v1", 1, "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z");
  const v2 = d("v2", 2, "2026-06-01T00:00:00Z");

  it("is active from active_from (inclusive) until active_to (exclusive)", () => {
    expect(isDefinitionActive(v1, new Date("2025-12-31T23:59:59Z"))).toBe(false);
    expect(isDefinitionActive(v1, new Date("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isDefinitionActive(v1, new Date("2026-06-01T00:00:00Z"))).toBe(false);
    expect(isDefinitionActive(v2, new Date("2030-01-01T00:00:00Z"))).toBe(true);
  });

  it("selects the version active at a given time", () => {
    expect(selectActiveDefinition([v1, v2], "creator_profile", new Date("2026-03-01Z"))?.id).toBe("v1");
    expect(selectActiveDefinition([v1, v2], "creator_profile", new Date("2026-07-01Z"))?.id).toBe("v2");
    expect(selectActiveDefinition([v1, v2], "financial_eligibility", new Date("2026-07-01Z"))).toBeNull();
  });

  it("prefers the highest version if windows overlap", () => {
    const overlapping = d("v3", 3, "2026-06-15T00:00:00Z");
    expect(selectActiveDefinition([v2, overlapping], "creator_profile", new Date("2026-07-01Z"))?.id).toBe("v3");
  });
});

describe("consent validity", () => {
  it("requires a granted receipt for the currently active version", () => {
    expect(hasValidConsentFor([{ consentDefinitionId: "v2", status: "granted" }], "v2")).toBe(true);
  });

  it("does not carry consent over to a new version", () => {
    expect(hasValidConsentFor([{ consentDefinitionId: "v1", status: "granted" }], "v2")).toBe(false);
  });

  it("treats withdrawn consent as not given", () => {
    expect(hasValidConsentFor([{ consentDefinitionId: "v2", status: "withdrawn" }], "v2")).toBe(false);
  });

  it("is false when no definition is active", () => {
    expect(hasValidConsentFor([{ consentDefinitionId: "v2", status: "granted" }], null)).toBe(false);
  });
});
