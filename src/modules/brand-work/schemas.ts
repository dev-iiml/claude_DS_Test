import { z } from "zod";

import { restrictedTextKinds } from "@/lib/restricted-text";

import {
  BILLED_PARTY_TYPES,
  BRAND_INDUSTRIES,
  BRAND_WORK_PLATFORMS,
  DELIVERABLE_TYPES,
  DOCUMENT_KINDS,
  VISIBILITIES,
} from "./domain";

const isoDate = z.iso.date("Use a full date.");

/** Free text the creator types: never identifiers (PAN, GSTIN, bank details, contacts). Those stay in the document. */
export const RESTRICTED_TEXT_MESSAGE =
  "Leave out tax IDs, bank details and contact details — they stay in your documents.";
const plain = (s: z.ZodString) => s.refine((v) => restrictedTextKinds(v).length === 0, RESTRICTED_TEXT_MESSAGE);
/** Fields the creator types that the restricted-text check covers (cleared from echoed form state when flagged). */
export const FREE_TEXT_FIELDS = ["endBrandName", "billedPartyName", "description", "deliverablesSummary"] as const;
const industryCodes = BRAND_INDUSTRIES.map(([c]) => c) as [string, ...string[]];

/** What the creator enters for a brand-work record. Amount in rupees (whole), stored as paise. */
export const recordInputSchema = z
  .object({
    endBrandName: plain(z.string().trim().min(2, "Enter the brand.").max(60)),
    billedPartyType: z.enum(BILLED_PARTY_TYPES, "Choose who you billed."),
    billedPartyName: plain(z.string().trim().max(60)).optional(),
    industryCode: z.enum(industryCodes).optional(),
    platforms: z.array(z.enum(BRAND_WORK_PLATFORMS)).min(1, "Choose at least one platform.").max(8),
    deliverables: z.array(z.enum(DELIVERABLE_TYPES)).min(1, "Choose at least one deliverable.").max(8),
    visibility: z.enum(VISIBILITIES).default("show_on_passport"),
    description: plain(z.string().trim().min(3, "Describe the work in a few words.").max(280)),
    deliverablesSummary: plain(z.string().trim().max(280)).optional(),
    workDate: isoDate,
    invoiceDate: isoDate.optional(),
    invoiceAmountRupees: z.coerce
      .number()
      .int("Whole rupees only.")
      .min(1)
      .max(10_00_00_000, "That's more than we can record.")
      .optional(),
  })
  .transform((v) => ({
    ...v,
    // With a brand billed directly, the billed party is the brand.
    billedPartyName: v.billedPartyType === "brand" ? v.endBrandName : (v.billedPartyName ?? ""),
  }))
  .refine((v) => v.billedPartyName.length >= 2, {
    message: "Enter the agency or platform you billed.",
    path: ["billedPartyName"],
  });
export type RecordInput = z.infer<typeof recordInputSchema>;

export const documentKindSchema = z.enum(DOCUMENT_KINDS);

/** Staff-only note: short, and checked for identifiers by the service. */
export const staffNoteSchema = z.string().trim().max(280).optional();
