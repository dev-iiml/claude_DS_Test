import { describe, expect, it } from "vitest";

import { isSensitiveKey } from "@/lib/sensitive-keys";
import { AuditMetadataError, sanitiseAuditMetadata } from "@/modules/audit/sanitise";

describe("audit metadata guard", () => {
  it("accepts small scalar, non-sensitive metadata", () => {
    expect(
      sanitiseAuditMetadata({ step: "about", gst_status: "registered", gst_id_provided: true, version: 1 }),
    ).toEqual({
      step: "about",
      gst_status: "registered",
      gst_id_provided: true,
      version: 1,
    });
  });

  it.each([
    "gstin",
    "pan",
    "user_pan",
    "panNumber",
    "aadhaar",
    "email",
    "mobile",
    "legal_name",
    "password",
    "bank_account",
    "bureau_score",
    "raw_payload",
  ])("rejects sensitive key %s", (key) => {
    expect(() => sanitiseAuditMetadata({ [key]: "x" })).toThrow(AuditMetadataError);
  });

  it("rejects nested objects and arrays", () => {
    expect(() => sanitiseAuditMetadata({ step: { nested: true } })).toThrow(AuditMetadataError);
    expect(() => sanitiseAuditMetadata({ step: ["a"] })).toThrow(AuditMetadataError);
  });

  it("truncates long strings and caps key count", () => {
    expect(sanitiseAuditMetadata({ note: "x".repeat(500) }).note).toHaveLength(200);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect(() => sanitiseAuditMetadata(many)).toThrow(AuditMetadataError);
  });
});

describe("sensitive key classification", () => {
  it("does not flag innocuous words that merely contain a sensitive substring", () => {
    for (const k of ["company", "expand", "step", "category", "consent_key", "definition_version", "legal_form"]) {
      expect(isSensitiveKey(k), k).toBe(false);
    }
  });
});
