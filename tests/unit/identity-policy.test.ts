import { describe, expect, it } from "vitest";

import {
  canAccessAdmin,
  canAccessCreatorArea,
  canAccessOps,
  homePathFor,
  postSignInPath,
  safeNextPath,
} from "@/modules/identity/policy";

const creator = { role: "creator" as const, onboardingComplete: true };
const newCreator = { role: "creator" as const, onboardingComplete: false };
const risk = { role: "risk_admin" as const, onboardingComplete: false };
const superAdmin = { role: "super_admin" as const, onboardingComplete: false };
const ops = { role: "ops_admin" as const, onboardingComplete: false };

describe("role access", () => {
  it("only staff roles reach admin", () => {
    expect(canAccessAdmin("creator")).toBe(false);
    expect(canAccessAdmin("risk_admin")).toBe(true);
    expect(canAccessAdmin("super_admin")).toBe(true);
  });

  it("ops and risk consoles are separate; super admins reach both", () => {
    expect(canAccessOps("ops_admin")).toBe(true);
    expect(canAccessOps("super_admin")).toBe(true);
    expect(canAccessOps("risk_admin")).toBe(false);
    expect(canAccessOps("creator")).toBe(false);
    expect(canAccessAdmin("ops_admin")).toBe(false);
    expect(canAccessCreatorArea("ops_admin")).toBe(false);
    expect(homePathFor(ops)).toBe("/ops");
    expect(postSignInPath(ops, "/ops/changes")).toBe("/ops/changes");
    expect(postSignInPath(ops, "/admin")).toBe("/ops");
    expect(postSignInPath(risk, "/ops")).toBe("/admin");
    expect(postSignInPath(superAdmin, "/ops/jobs")).toBe("/ops/jobs");
    expect(safeNextPath("/opsx", ops)).toBeNull();
  });

  it("only creators reach creator areas", () => {
    expect(canAccessCreatorArea("creator")).toBe(true);
    expect(canAccessCreatorArea("risk_admin")).toBe(false);
  });
});

describe("role-aware home", () => {
  it("routes by role and onboarding state", () => {
    expect(homePathFor(creator)).toBe("/dashboard");
    expect(homePathFor(newCreator)).toBe("/onboarding");
    expect(homePathFor(risk)).toBe("/admin");
    expect(homePathFor(superAdmin)).toBe("/admin");
  });
});

describe("post sign-in redirect", () => {
  it("honours safe, permitted next paths", () => {
    expect(postSignInPath(creator, "/dashboard?tab=1")).toBe("/dashboard?tab=1");
    expect(postSignInPath(risk, "/admin")).toBe("/admin");
    expect(postSignInPath(newCreator, "/onboarding/business")).toBe("/onboarding/business");
  });

  it("honours member areas for completed creators only", () => {
    for (const path of ["/passport", "/passport/signals", "/account", "/access", "/connect/mock?state=x"]) {
      expect(postSignInPath(creator, path)).toBe(path);
      expect(postSignInPath(newCreator, path)).toBe("/onboarding");
      expect(postSignInPath(risk, path)).toBe("/admin");
    }
    expect(safeNextPath("/passports", creator)).toBeNull();
  });

  it("ignores next paths the role may not use", () => {
    expect(postSignInPath(creator, "/admin")).toBe("/dashboard");
    expect(postSignInPath(risk, "/dashboard")).toBe("/admin");
    expect(postSignInPath(newCreator, "/dashboard")).toBe("/onboarding");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/login",
    "/unknown",
    "",
  ])("rejects unsafe next %s", (next) => {
    expect(safeNextPath(next, creator)).toBeNull();
  });
});
