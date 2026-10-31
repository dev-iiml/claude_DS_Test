import { z } from "zod";

import { OPPORTUNITY_KINDS } from "./domain";
import type { CreatorAvailability, CreatorOpportunityView } from "./opportunity-service";

/**
 * Filter and sort for the creator's Access list (web and API v1). Pure: works
 * on the views the service already built, so the availability rules stay in
 * one place.
 */

export const ACCESS_SHOW = ["all", "available", "mine", "locked"] as const;
export type AccessShow = (typeof ACCESS_SHOW)[number];

export const ACCESS_SORTS = ["recommended", "closing", "points_low", "points_high", "newest"] as const;
export type AccessSort = (typeof ACCESS_SORTS)[number];

export const ACCESS_SHOW_LABELS: Record<AccessShow, string> = {
  all: "Everything",
  available: "You can request",
  mine: "Your requests",
  locked: "Not available yet",
};

export const ACCESS_SORT_LABELS: Record<AccessSort, string> = {
  recommended: "Recommended",
  closing: "Closing soon",
  points_low: "Fewest points",
  points_high: "Most points",
  newest: "Newest",
};

export const ACCESS_PAGE_SIZE = 24;

export const accessBrowseSchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  kind: z.enum(OPPORTUNITY_KINDS).optional().catch(undefined),
  category: z.string().trim().max(60).optional().catch(undefined),
  show: z.enum(ACCESS_SHOW).default("all").catch("all"),
  sort: z.enum(ACCESS_SORTS).default("recommended").catch("recommended"),
  page: z.coerce.number().int().min(1).max(100).default(1).catch(1),
});
export type AccessBrowse = z.infer<typeof accessBrowseSchema>;

const MINE: CreatorAvailability[] = ["requested", "approved"];
const LOCKED: CreatorAvailability[] = ["tier_locked", "insufficient_points", "full", "not_open_yet"];

/** What the creator can act on first, then what's theirs, then the rest. */
const rank = (a: CreatorAvailability) => (a === "open" ? 0 : MINE.includes(a) ? 1 : 2);

export function browseOpportunities(
  all: readonly CreatorOpportunityView[],
  b: AccessBrowse,
): { items: CreatorOpportunityView[]; total: number; categories: string[]; pages: number } {
  const needle = b.q?.toLowerCase();
  const filtered = all.filter(
    (o) =>
      (!b.kind || o.kind === b.kind) &&
      (!b.category || o.category === b.category) &&
      (b.show === "all" ||
        (b.show === "available" && o.availability === "open") ||
        (b.show === "mine" && MINE.includes(o.availability)) ||
        (b.show === "locked" && LOCKED.includes(o.availability))) &&
      (!needle ||
        o.title.toLowerCase().includes(needle) ||
        o.brand.name.toLowerCase().includes(needle) ||
        o.category.toLowerCase().includes(needle)),
  );
  const byClose = (x: CreatorOpportunityView, y: CreatorOpportunityView) =>
    x.closesAt.getTime() - y.closesAt.getTime() || x.title.localeCompare(y.title);
  const compare: Record<AccessSort, (x: CreatorOpportunityView, y: CreatorOpportunityView) => number> = {
    recommended: (x, y) => rank(x.availability) - rank(y.availability) || byClose(x, y),
    closing: byClose,
    points_low: (x, y) => x.pointsCost - y.pointsCost || byClose(x, y),
    points_high: (x, y) => y.pointsCost - x.pointsCost || byClose(x, y),
    newest: (x, y) => y.opensAt.getTime() - x.opensAt.getTime() || byClose(x, y),
  };
  const sorted = [...filtered].sort(compare[b.sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / ACCESS_PAGE_SIZE));
  const page = Math.min(b.page, pages);
  return {
    items: sorted.slice((page - 1) * ACCESS_PAGE_SIZE, page * ACCESS_PAGE_SIZE),
    total: sorted.length,
    categories: [...new Set(all.map((o) => o.category))].sort((x, y) => x.localeCompare(y)),
    pages,
  };
}
