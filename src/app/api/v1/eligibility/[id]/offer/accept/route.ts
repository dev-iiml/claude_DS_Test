import { z } from "zod";

import { getDb } from "@/db";
import { acceptOffer, getCreatorLenderView } from "@/modules/lending";

import { requireApiCreator } from "../../../../_lib/auth";
import { ApiError, json, readJson, route } from "../../../../_lib/http";
import { toEligibilityApiError } from "../../../_errors";

/**
 * Accept the reviewed offer (Stage 13). Send the `termsHash` from `lender.offer`, the active
 * `lender_handoff` consent definition id with `agree: true`, and `kfsAcknowledged: true`.
 */
export const POST = route<RouteContext<"/api/v1/eligibility/[id]/offer/accept">>(
  "eligibility.offer.accept",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
    const body = await readJson(
      request,
      z.object({
        termsHash: z.string().regex(/^[0-9a-f]{64}$/),
        kfsAcknowledged: z.literal(true),
        consentDefinitionId: z.uuid(),
        agree: z.literal(true),
      }),
    );
    try {
      const db = getDb();
      await acceptOffer(db, {
        userId: user.userId,
        applicationId: id,
        termsHash: body.termsHash,
        kfsAcknowledged: true,
        consentDefinitionId: body.consentDefinitionId,
        source: "api",
      });
      return json(await getCreatorLenderView(db, { userId: user.userId, applicationId: id }));
    } catch (error) {
      toEligibilityApiError(error);
    }
  },
);
