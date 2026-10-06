import { describe, expect, it } from "vitest";

import {
  advanceProgress,
  canAccessStep,
  classifyCohort,
  computeProfileCompletion,
  isPilotSupportedLegalForm,
  nextOnboardingStep,
  normaliseGstDeclaration,
  type CompletionInput,
} from "@/modules/creator-profile/rules";

describe("pilot legal forms (Cohort A0)", () => {
  it("accepts individuals and sole proprietors", () => {
    expect(isPilotSupportedLegalForm("individual")).toBe(true);
    expect(isPilotSupportedLegalForm("sole_proprietorship")).toBe(true);
  });

  it("does not accept incorporated or partnership forms", () => {
    for (const f of ["llp", "private_limited", "one_person_company", "partnership", "other_entity"] as const) {
      expect(isPilotSupportedLegalForm(f), f).toBe(false);
    }
  });
});

describe("GST declaration", () => {
  it("keeps the GSTIN only when the creator declares registration", () => {
    expect(normaliseGstDeclaration("registered", "27AAPFU0939F1ZV").gstin).toBe("27AAPFU0939F1ZV");
    expect(normaliseGstDeclaration("not_registered", "27AAPFU0939F1ZV").gstin).toBeNull();
    expect(normaliseGstDeclaration("unknown_requires_review", "27AAPFU0939F1ZV").gstin).toBeNull();
  });

  it("allows registration without a GSTIN (capture is optional)", () => {
    expect(normaliseGstDeclaration("registered", null)).toEqual({ gstStatus: "registered", gstin: null });
  });

  it("never changes the declared status", () => {
    for (const s of ["not_registered", "registered", "unknown_requires_review"] as const) {
      expect(normaliseGstDeclaration(s, null).gstStatus).toBe(s);
    }
  });
});

describe("cohort classification (descriptive, not a tax determination)", () => {
  it("treats legal form and GST status independently", () => {
    expect(classifyCohort("individual", "not_registered")).toBe("A0");
    expect(classifyCohort("sole_proprietorship", "not_registered")).toBe("A0");
    expect(classifyCohort("individual", "registered")).toBe("A1");
    expect(classifyCohort("sole_proprietorship", "registered")).toBe("A1");
    expect(classifyCohort("individual", "unknown_requires_review")).toBe("requires_review");
    expect(classifyCohort("private_limited", "registered")).toBe("B");
    expect(classifyCohort("llp", "not_registered")).toBe("B");
  });
});

describe("onboarding step navigation", () => {
  it("starts at 'about' and ends at 'done'", () => {
    expect(nextOnboardingStep(null)).toBe("about");
    expect(nextOnboardingStep("about")).toBe("profile");
    expect(nextOnboardingStep("interests")).toBe("consent");
    expect(nextOnboardingStep("consent")).toBe("done");
  });

  it("prevents skipping ahead but allows revisiting", () => {
    expect(canAccessStep("about", null)).toBe(true);
    expect(canAccessStep("profile", null)).toBe(false);
    expect(canAccessStep("business", "about")).toBe(false);
    expect(canAccessStep("business", "profile")).toBe(true);
    expect(canAccessStep("about", "interests")).toBe(true);
  });

  it("never regresses progress when an earlier step is re-saved", () => {
    expect(advanceProgress("interests", "about")).toBe("interests");
    expect(advanceProgress("about", "profile")).toBe("profile");
    expect(advanceProgress(null, "about")).toBe("about");
  });
});

describe("profile completion", () => {
  const complete: CompletionInput = {
    displayName: "A",
    legalName: "A B",
    city: "Pune",
    state: "Maharashtra",
    languages: ["en"],
    primaryCreatorHandle: "ab",
    creatorCategory: "beauty",
    creatorSince: "2020-01-01",
    declaredPlatforms: 1,
    connectedAccounts: 1,
    legalForm: "individual",
    gstStatus: "not_registered",
    hasInterests: true,
    hasCreatorProfileConsent: true,
  };

  it("is 100% when everything is present", () => {
    expect(computeProfileCompletion(complete).percent).toBe(100);
  });

  it("is below 100% until an account is connected (onboarding alone is not 'complete')", () => {
    const r = computeProfileCompletion({ ...complete, connectedAccounts: 0 });
    expect(r.percent).toBe(80);
    expect(r.items.find((i) => i.key === "connected")?.done).toBe(false);
  });

  it("is 0% for an empty profile", () => {
    const r = computeProfileCompletion({
      ...complete,
      displayName: null,
      legalName: null,
      city: null,
      state: null,
      languages: [],
      primaryCreatorHandle: null,
      creatorCategory: null,
      creatorSince: null,
      declaredPlatforms: 0,
      connectedAccounts: 0,
      legalForm: null,
      gstStatus: null,
      hasInterests: false,
      hasCreatorProfileConsent: false,
    });
    expect(r.percent).toBe(0);
  });
});
