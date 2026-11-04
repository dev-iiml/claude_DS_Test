import { z } from "zod";

import { getDb } from "@/db";
import { cancelAccessRequest } from "@/modules/access";
import { getPointsSummary } from "@/modules/rewards/ledger-service";

import { toApiError } from "../../../../_lib/errors";
import { ApiError, json, route } from "../../../../_lib/http";
import { requireApiMember } from "../../../_member";

/** Cancel a pending request; its points are returned. */
export const POST = route<RouteContext<"/api/v1/access/requests/[id]/cancel">>(
  "access.cancel",
  async (request, ctx) => {
    const { user, creatorId } = await requireApiMember(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Request not found.");
    try {
      const db = getDb();
      await cancelAccessRequest(db, { userId: user.userId, requestId: id });
      const points = await getPointsSummary(db, creatorId, 0);
      return json({ cancelled: true, points: { balance: points.balance, onHold: points.onHold } });
    } catch (error) {
      toApiError(error);
    }
  },
);
