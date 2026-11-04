import { getDb } from "@/db";
import { listOpportunitiesForCreator, listRequestsForCreator } from "@/modules/access";
import { accessBrowseSchema, browseOpportunities } from "@/modules/access/browse";
import { getPointsSummary } from "@/modules/rewards/ledger-service";

import { json, route } from "../_lib/http";

import { requireApiMember } from "./_member";

/**
 * Open Access opportunities (with what this creator can do on each), their requests and points balance.
 * Optional `?q=&kind=&category=&show=all|available|mine|locked&sort=recommended|closing|points_low|points_high|newest&page=`.
 */
export const GET = route("access.list", async (request) => {
  const { user, creatorId } = await requireApiMember(request);
  const db = getDb();
  const [opportunities, requests, points] = await Promise.all([
    listOpportunitiesForCreator(db, { userId: user.userId, creatorId }),
    listRequestsForCreator(db, user.userId),
    getPointsSummary(db, creatorId, 0),
  ]);
  const params = new URL(request.url).searchParams;
  const browse = accessBrowseSchema.parse({
    q: params.get("q") || undefined,
    kind: params.get("kind") || undefined,
    category: params.get("category") || undefined,
    show: params.get("show") || undefined,
    sort: params.get("sort") || undefined,
    page: params.get("page") || undefined,
  });
  const result = browseOpportunities(opportunities, browse);
  return json({
    preview: true,
    points: { balance: points.balance, onHold: points.onHold },
    opportunities: result.items,
    page: Math.min(browse.page, result.pages),
    pages: result.pages,
    total: result.total,
    categories: result.categories,
    requests,
  });
});
