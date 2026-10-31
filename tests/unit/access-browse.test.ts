import { describe, expect, it } from "vitest";

import { ACCESS_PAGE_SIZE, accessBrowseSchema, browseOpportunities } from "@/modules/access/browse";
import type { CreatorAvailability, CreatorOpportunityView } from "@/modules/access";

function view(n: number, over: Partial<CreatorOpportunityView> = {}): CreatorOpportunityView {
  return {
    id: `id-${n}`,
    title: `Item ${String(n).padStart(2, "0")}`,
    kind: "event",
    category: "Fashion",
    summary: "s",
    details: "d",
    brand: { name: `Brand ${n}`, isSample: true },
    minTier: "member",
    pointsCost: n * 10,
    seatsLeft: 5,
    opensAt: new Date(Date.UTC(2026, 8, n)),
    closesAt: new Date(Date.UTC(2027, 0, 30 - n)),
    isSample: true,
    availability: "open" as CreatorAvailability,
    request: null,
    ...over,
  };
}

const parse = (o: Record<string, unknown>) => accessBrowseSchema.parse(o);

describe("Access browse (filter, sort, page)", () => {
  const all = [
    view(1, { availability: "tier_locked", kind: "programme", category: "Tech" }),
    view(2, { availability: "requested" }),
    view(3, { brand: { name: "Aurel Beauty", isSample: true }, category: "Beauty" }),
    view(4, { availability: "not_open_yet" }),
  ];

  it("recommended puts what you can request first, then your requests, then the rest", () => {
    expect(browseOpportunities(all, parse({})).items.map((o) => o.id)).toEqual(["id-3", "id-2", "id-4", "id-1"]);
  });

  it("filters by show, kind, category and search (brand, title, category)", () => {
    expect(browseOpportunities(all, parse({ show: "available" })).items.map((o) => o.id)).toEqual(["id-3"]);
    expect(browseOpportunities(all, parse({ show: "mine" })).items.map((o) => o.id)).toEqual(["id-2"]);
    expect(browseOpportunities(all, parse({ show: "locked" })).total).toBe(2);
    expect(browseOpportunities(all, parse({ kind: "programme" })).items.map((o) => o.id)).toEqual(["id-1"]);
    expect(browseOpportunities(all, parse({ category: "Beauty" })).total).toBe(1);
    expect(browseOpportunities(all, parse({ q: "aurel" })).items.map((o) => o.id)).toEqual(["id-3"]);
    expect(browseOpportunities(all, parse({})).categories).toEqual(["Beauty", "Fashion", "Tech"]);
  });

  it("sorts by points and closing date", () => {
    expect(browseOpportunities(all, parse({ sort: "points_high" })).items[0]!.id).toBe("id-4");
    expect(browseOpportunities(all, parse({ sort: "points_low" })).items[0]!.id).toBe("id-1");
    expect(browseOpportunities(all, parse({ sort: "closing" })).items[0]!.id).toBe("id-4");
    expect(browseOpportunities(all, parse({ sort: "newest" })).items[0]!.id).toBe("id-4");
  });

  it("pages and clamps out-of-range pages; bad params fall back to defaults", () => {
    const many = Array.from({ length: ACCESS_PAGE_SIZE + 3 }, (_, i) => view(i + 1));
    const p2 = browseOpportunities(many, parse({ page: 2 }));
    expect(p2.pages).toBe(2);
    expect(p2.items).toHaveLength(3);
    expect(browseOpportunities(many, parse({ page: 9 })).items).toHaveLength(3);
    expect(parse({ sort: "drop table", show: "x", kind: "nope", page: "-1" })).toMatchObject({
      sort: "recommended",
      show: "all",
      page: 1,
    });
  });
});
