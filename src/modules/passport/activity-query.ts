import { z } from "zod";

import { ACTIVITY_KINDS } from "./activity-kinds";

/** Filter / sort / page for the creator's activity list (web and API v1). Pure. */
export const activityQuerySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS).optional().catch(undefined),
  sort: z.enum(["newest", "oldest"]).default("newest").catch("newest"),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});
export type ActivityQueryInput = z.infer<typeof activityQuerySchema>;

/** First value of a search param (Next gives string | string[] | undefined). */
export function firstParam(v: string | string[] | null | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}
