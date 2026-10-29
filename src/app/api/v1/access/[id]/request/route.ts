import { z } from "zod";

import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { getOpportunityForCreator, requestAccess } from "@/modules/access";
import { requestNoteSchema } from "@/modules/access/schemas";

import { toApiError } from "../../../_lib/errors";
import { ApiError, json, rateLimited, readJson, route } from "../../../_lib/http";
import { requireApiMember } from "../../_member";

/**
 * Request an opportunity (holds its Creator Points). If the `brand_opportunities` consent isn't given yet, send
 * the active definition id with `agree: true` — it's granted with the request, or not at all.
 */
export const POST = route<RouteContext<"/api/v1/access/[id]/request">>("access.request", async (request, ctx) => {
  const { user, creatorId } = await requireApiMember(request);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Opportunity not found.");
  const body = await readJson(
    request,
    z
      .object({
        note: requestNoteSchema.optional(),
        consentDefinitionId: z.uuid().optional(),
        agree: z.literal(true).optional(),
      })
      .refine((b) => !b.consentDefinitionId || b.agree === true, {
        path: ["agree"],
        message: "Send agree: true with the consent definition.",
      }),
  );
  const limited = await rateLimit("access.request", user.userId);
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  try {
    const db = getDb();
    await requestAccess(db, {
      userId: user.userId,
      opportunityId: id,
      note: body.note ?? null,
      consentDefinitionId: body.consentDefinitionId ?? null,
      source: "api",
    });
    return json(await getOpportunityForCreator(db, { userId: user.userId, creatorId, opportunityId: id }), 201);
  } catch (error) {
    toApiError(error);
  }
});
