import { z } from "zod";

import { CREATOR_STATUS_TIERS } from "@/modules/creator-status/status";

import { ACCESS_DECLINE_REASONS, MAX_POINTS_COST, MAX_REQUEST_NOTE, MAX_SEATS, OPPORTUNITY_KINDS } from "./domain";

/** Pure input schemas for Access (web forms, API, staff desk). */

export const requestNoteSchema = z
  .string()
  .trim()
  .max(MAX_REQUEST_NOTE, `Keep your note under ${MAX_REQUEST_NOTE} characters.`)
  .transform((s) => (s.length ? s : null))
  .nullable();

export const opportunityInputSchema = z
  .object({
    brandId: z.uuid("Choose a brand."),
    title: z.string().trim().min(3, "Add a title.").max(80),
    kind: z.enum(OPPORTUNITY_KINDS, "Choose a kind."),
    category: z.string().trim().min(2, "Add a category.").max(60),
    summary: z.string().trim().min(3, "Add a one-line summary.").max(200),
    details: z.string().trim().min(3, "Add the details.").max(2000),
    minTier: z.enum(CREATOR_STATUS_TIERS, "Choose who can request it."),
    pointsCost: z.coerce.number().int("Whole points only.").min(0).max(MAX_POINTS_COST),
    seats: z.coerce.number().int("Whole seats only.").min(1).max(MAX_SEATS),
    opensAt: z.coerce.date("Pick when requests open."),
    closesAt: z.coerce.date("Pick when requests close."),
    status: z.enum(["draft", "live"]),
  })
  .strict()
  .refine((o) => o.closesAt.getTime() > o.opensAt.getTime(), {
    path: ["closesAt"],
    message: "Requests must close after they open.",
  });
export type OpportunityInput = z.output<typeof opportunityInputSchema>;

export const accessDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }).strict(),
  z.object({ decision: z.literal("decline"), reason: z.enum(ACCESS_DECLINE_REASONS, "Choose a reason.") }).strict(),
]);
export type AccessDecision = z.output<typeof accessDecisionSchema>;
