import { describe, expect, it } from "vitest";

import { fictionalGstin } from "@/db/seed/demo";
import { explainGstin, gstinCheckCharacter, isValidGstin, normaliseGstin } from "@/modules/creator-profile/gstin";

describe("GSTIN validation", () => {
  it("accepts a GSTIN with a correct check character", () => {
    // Widely published sample GSTIN used in GSTN documentation examples.
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
  });

  it("rejects a wrong check character", () => {
    expect(isValidGstin("27AAPFU0939F1ZA")).toBe(false);
  });

  it("rejects malformed values", () => {
    for (const bad of [
      "",
      "27AAPFU0939F1Z",
      "27AAPFU0939F1ZVV",
      "AAAPFU0939F1ZV1",
      "27AAPFU0939F0ZV",
      "27AAPFU0939F1XV",
    ]) {
      expect(isValidGstin(bad), bad).toBe(false);
    }
  });

  it("normalises case and whitespace before validating", () => {
    expect(normaliseGstin(" 27aapfu0939f1zv ")).toBe("27AAPFU0939F1ZV");
    expect(isValidGstin("27aapfu 0939f1zv")).toBe(true);
  });

  it("computes the check character deterministically", () => {
    expect(gstinCheckCharacter("27AAPFU0939F1Z")).toBe("V");
  });

  it("produces valid fictional seed GSTINs that use an impossible PAN holder type", () => {
    const g = fictionalGstin("08");
    expect(isValidGstin(g)).toBe(true);
    expect(g.slice(2, 12)).toBe("ZZZZZ9999Z");
  });
});

describe("as-you-type GSTIN feedback", () => {
  it("guides through each position", () => {
    expect(explainGstin("")).toEqual({ state: "empty" });
    expect(explainGstin("27AAP")).toMatchObject({ state: "incomplete" });
    expect(explainGstin("2A")).toMatchObject({ state: "invalid", message: expect.stringContaining("Character 2") });
    expect(explainGstin("27AAPF1")).toMatchObject({ state: "invalid", message: expect.stringContaining("letter") });
    expect(explainGstin("27AAPFU0939F1X")).toMatchObject({
      state: "invalid",
      message: expect.stringContaining("letter Z"),
    });
    expect(explainGstin("27AAPFU0939F0")).toMatchObject({
      state: "invalid",
      message: expect.stringContaining("Character 13"),
    });
  });

  it("rejects bad state codes, bad characters and wrong check digits", () => {
    expect(explainGstin("45AAPFU0939F1ZV")).toMatchObject({
      state: "invalid",
      message: expect.stringContaining("state code"),
    });
    expect(explainGstin("27AAPFU-939F1ZV")).toMatchObject({ state: "invalid" });
    expect(explainGstin("27AAPFU0939F1ZA")).toMatchObject({
      state: "invalid",
      message: expect.stringContaining("check digit"),
    });
  });

  it("accepts a complete valid GSTIN, normalising case", () => {
    expect(explainGstin("27aapfu0939f1zv")).toEqual({ state: "valid", gstin: "27AAPFU0939F1ZV" });
  });
});
