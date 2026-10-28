import { getDb } from "@/db";
import { listOpportunitiesForCreator, listRequestsForCreator } from "@/modules/access";
import { getPointsSummary } from "@/modules/rewards/ledger-service";

import { json, route } from "../_lib/http";

import { requireApiMember } from "./_member";

/** Open Access opportunities (with what this creator can do on each), their requests and points balance. */
export const GET = route("access.list", async (request) => {
  const { user, creatorId } = await requireApiMember(request);
  const db = getDb();
  const [opportunities, requests, points] = await Promise.all([
    listOpportunitiesForCreator(db, { userId: user.userId, creatorId }),
    listRequestsForCreator(db, user.userId),
    getPointsSummary(db, creatorId, 0),
  ]);
  return json({
    preview: true,
    points: { balance: points.balance, onHold: points.onHold },
    opportunities,
    requests,
  });
});
