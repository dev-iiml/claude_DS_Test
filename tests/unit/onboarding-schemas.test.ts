import { describe, expect, it } from "vitest";

import {
  aboutStepSchema,
  businessStepSchema,
  consentStepSchema,
  isFutureMonth,
  profileStepSchema,
} from "@/modules/creator-profile/schemas";

const errorPaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.path.join(".")) ?? []);

describe("business step schema", () => {
  it("accepts an A0 individual who is not GST registered", () => {
    const r = businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" });
    expect(r).toEqual({ legalForm: "individual", gstStatus: "not_registered", gstin: null });
  });

  it("does not infer GST status from legal form", () => {
    // A sole proprietor may or may not be registered; both are accepted as declared.
    expect(businessStepSchema.parse({ legalForm: "sole_proprietorship", gstStatus: "not_registered" }).gstStatus).toBe(
      "not_registered",
    );
    expect(businessStepSchema.parse({ legalForm: "individual", gstStatus: "registered" }).gstStatus).toBe("registered");
  });

  it("accepts 'unknown / requires review' without blocking", () => {
    expect(
      businessStepSchema.safeParse({ legalForm: "individual", gstStatus: "unknown_requires_review" }).success,
    ).toBe(true);
  });

  it("captures and normalises a valid GSTIN only when registered", () => {
    const r = businessStepSchema.parse({ legalForm: "individual", gstStatus: "registered", gstin: "27aapfu0939f1zv" });
    expect(r.gstin).toBe("27AAPFU0939F1ZV");
  });

  it("discards a GSTIN submitted without a registered declaration", () => {
    const r = businessStepSchema.parse({
      legalForm: "individual",
      gstStatus: "not_registered",
      gstin: "27AAPFU0939F1ZV",
    });
    expect(r.gstin).toBeNull();
  });

  it("rejects an invalid GSTIN when registered", () => {
    const r = businessStepSchema.safeParse({
      legalForm: "individual",
      gstStatus: "registered",
      gstin: "27AAPFU0939F1ZA",
    });
    expect(errorPaths(r)).toContain("gstin");
  });

  it("allows registration without a GSTIN", () => {
    expect(businessStepSchema.safeParse({ legalForm: "individual", gstStatus: "registered" }).success).toBe(true);
  });

  it("rejects incorporated forms as not supported in the pilot", () => {
    for (const legalForm of ["llp", "private_limited", "one_person_company", "partnership"]) {
      const r = businessStepSchema.safeParse({ legalForm, gstStatus: "registered" });
      expect(errorPaths(r), legalForm).toContain("legalForm");
    }
  });

  it("rejects unknown values", () => {
    expect(businessStepSchema.safeParse({ legalForm: "individual", gstStatus: "exempt" }).success).toBe(false);
    expect(businessStepSchema.safeParse({ legalForm: "trust", gstStatus: "registered" }).success).toBe(false);
  });
});

describe("about step schema", () => {
  it("requires legal name, display name and at least one language", () => {
    const r = aboutStepSchema.safeParse({ legalName: " ", displayName: "", languages: [] });
    expect(errorPaths(r)).toEqual(expect.arrayContaining(["legalName", "displayName", "languages"]));
  });

  it("rejects unknown languages and states, trims and de-duplicates", () => {
    expect(aboutStepSchema.safeParse({ legalName: "Asha Rao", displayName: "Asha", languages: ["xx"] }).success).toBe(
      false,
    );
    expect(
      aboutStepSchema.safeParse({ legalName: "Asha Rao", displayName: "Asha", state: "Atlantis", languages: ["en"] })
        .success,
    ).toBe(false);
    const ok = aboutStepSchema.parse({
      legalName: "  Asha Rao ",
      displayName: "Asha",
      city: "",
      state: "",
      languages: ["en", "en", "hi"],
    });
    expect(ok).toMatchObject({ legalName: "Asha Rao", city: null, state: null, languages: ["en", "hi"] });
  });
});

describe("profile step schema", () => {
  const base = { primaryCreatorHandle: "@asha.makes", categories: ["beauty"], platforms: ["instagram"] };

  it("strips a leading @ and defaults platform handles to the primary handle", () => {
    const r = profileStepSchema.parse({ ...base, platformHandles: { instagram: "" } });
    expect(r.primaryCreatorHandle).toBe("asha.makes");
    expect(r.platforms).toEqual([{ code: "instagram", handle: "asha.makes" }]);
  });

  it("keeps a distinct per-platform handle", () => {
    const r = profileStepSchema.parse({
      ...base,
      platforms: ["instagram", "youtube"],
      platformHandles: { youtube: "@AshaMakesTV" },
    });
    expect(r.platforms).toEqual([
      { code: "instagram", handle: "asha.makes" },
      { code: "youtube", handle: "AshaMakesTV" },
    ]);
  });

  it("requires at least one platform and a valid handle", () => {
    expect(errorPaths(profileStepSchema.safeParse({ ...base, platforms: [] }))).toContain("platforms");
    expect(errorPaths(profileStepSchema.safeParse({ ...base, primaryCreatorHandle: "has space" }))).toContain(
      "primaryCreatorHandle",
    );
    expect(
      errorPaths(profileStepSchema.safeParse({ ...base, platformHandles: { instagram: "bad handle!" } })),
    ).toContain("handle_instagram");
  });

  it("validates creator-since month format", () => {
    expect(profileStepSchema.safeParse({ ...base, creatorSince: "2019-13" }).success).toBe(false);
    expect(profileStepSchema.safeParse({ ...base, creatorSince: "1999-01" }).success).toBe(false);
    expect(profileStepSchema.parse({ ...base, creatorSince: "2019-06" }).creatorSince).toBe("2019-06");
    expect(profileStepSchema.parse({ ...base, creatorSince: "" }).creatorSince).toBeNull();
  });

  it("detects future months", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    expect(isFutureMonth("2026-10", now)).toBe(false);
    expect(isFutureMonth("2026-11", now)).toBe(true);
    expect(isFutureMonth("2027-01", now)).toBe(true);
  });
});

describe("profile step categories", () => {
  const base = { primaryCreatorHandle: "asha", platforms: ["instagram"] };

  it("accepts up to three categories with one primary", () => {
    const r = profileStepSchema.parse({
      ...base,
      categories: ["beauty", "fashion", "travel"],
      primaryCategory: "fashion",
    });
    expect(r.creatorCategory).toBe("fashion");
    expect(r.additionalCategories).toEqual(["beauty", "travel"]);
  });

  it("defaults the primary to the first category", () => {
    const r = profileStepSchema.parse({ ...base, categories: ["food", "travel"] });
    expect(r.creatorCategory).toBe("food");
    expect(r.additionalCategories).toEqual(["travel"]);
  });

  it("rejects more than three, none, or a primary that wasn't selected", () => {
    expect(errorPaths(profileStepSchema.safeParse({ ...base, categories: ["a1", "b1", "c1", "d1"] }))).toContain(
      "categories",
    );
    expect(errorPaths(profileStepSchema.safeParse({ ...base, categories: [] }))).toContain("categories");
    expect(
      errorPaths(profileStepSchema.safeParse({ ...base, categories: ["beauty"], primaryCategory: "tech" })),
    ).toContain("primaryCategory");
  });
});

describe("about step location and languages", () => {
  const base = { legalName: "Asha Rao", displayName: "Asha", languages: ["en"] };

  it("accepts a city from the chosen state's list", () => {
    expect(aboutStepSchema.parse({ ...base, state: "Karnataka", city: "Mysuru" })).toMatchObject({
      state: "Karnataka",
      city: "Mysuru",
    });
  });

  it("rejects a city that isn't in the state's list, or a city without a state", () => {
    expect(errorPaths(aboutStepSchema.safeParse({ ...base, state: "Karnataka", city: "Pune" }))).toContain("city");
    expect(errorPaths(aboutStepSchema.safeParse({ ...base, city: "Pune" }))).toContain("state");
  });

  it("uses the typed city when Other is chosen", () => {
    expect(aboutStepSchema.parse({ ...base, state: "Kerala", city: "__other__", cityOther: "Munnar" }).city).toBe(
      "Munnar",
    );
    expect(
      errorPaths(aboutStepSchema.safeParse({ ...base, state: "Kerala", city: "__other__", cityOther: "" })),
    ).toContain("cityOther");
  });

  it("accepts other languages, de-duplicated, and counts them towards the minimum", () => {
    const r = aboutStepSchema.parse({ ...base, languages: [], languagesOther: ["Konkani", "konkani", "Tulu"] });
    expect(r.languagesOther).toEqual(["Konkani", "Tulu"]);
  });

  it("rejects invalid or already-listed other languages, and requires at least one language overall", () => {
    expect(errorPaths(aboutStepSchema.safeParse({ ...base, languagesOther: ["123"] }))).toContain("languagesOther");
    expect(errorPaths(aboutStepSchema.safeParse({ ...base, languagesOther: ["Hindi"] }))).toContain("languagesOther");
    expect(errorPaths(aboutStepSchema.safeParse({ ...base, languages: [], languagesOther: [] }))).toContain(
      "languages",
    );
    expect(
      errorPaths(aboutStepSchema.safeParse({ ...base, languagesOther: ["Aa", "Bb", "Cc", "Dd", "Ee", "Ff"] })),
    ).toContain("languagesOther");
  });
});

describe("consent step schema", () => {
  it("requires explicit agreement and a definition id", () => {
    expect(
      consentStepSchema.safeParse({ consentDefinitionId: "00000000-0000-4000-8000-00000000c001", agree: false })
        .success,
    ).toBe(false);
    expect(consentStepSchema.safeParse({ consentDefinitionId: "not-a-uuid", agree: true }).success).toBe(false);
    expect(
      consentStepSchema.safeParse({ consentDefinitionId: "00000000-0000-4000-8000-00000000c001", agree: true }).success,
    ).toBe(true);
  });
});
