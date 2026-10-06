import { z } from "zod";

import { getDb } from "@/db";
import { OFFER_DECLINE_REASONS, declineOffer, getCreatorLenderView } from "@/modules/lending";

import { requireApiCreator } from "../../../../_lib/auth";
import { ApiError, json, readJson, route } from "../../../../_lib/http";
import { toEligibilityApiError } from "../../../_errors";

/** Decline the reviewed offer (Stage 13), optionally with a reason. */
export const POST = route<RouteContext<"/api/v1/eligibility/[id]/offer/decline">>(
  "eligibility.offer.decline",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
    const body = await readJson(request, z.object({ reason: z.enum(OFFER_DECLINE_REASONS).optional() }));
    try {
      const db = getDb();
      await declineOffer(db, { userId: user.userId, applicationId: id, reason: body.reason ?? null });
      return json(await getCreatorLenderView(db, { userId: user.userId, applicationId: id }));
    } catch (error) {
      toEligibilityApiError(error);
    }
  },
);
