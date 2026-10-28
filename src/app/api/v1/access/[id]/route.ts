import { z } from "zod";

import { getDb } from "@/db";
import { getOpportunityForCreator } from "@/modules/access";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";

import { ApiError, json, route } from "../../_lib/http";
import { requireApiMember } from "../_member";

/** One opportunity, this creator's latest request for it, and whether the brand consent is still needed. */
export const GET = route<RouteContext<"/api/v1/access/[id]">>("access.get", async (request, ctx) => {
  const { user, creatorId } = await requireApiMember(request);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Opportunity not found.");
  const db = getDb();
  const opportunity = await getOpportunityForCreator(db, { userId: user.userId, creatorId, opportunityId: id });
  if (!opportunity) throw new ApiError(404, "not_found", "Opportunity not found.");
  const consentGiven = await hasValidConsent(db, user.userId, CONSENT_KEYS.brandOpportunities);
  return json({ preview: true, opportunity, consentRequired: !consentGiven });
});
