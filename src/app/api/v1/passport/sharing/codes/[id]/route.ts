import { z } from "zod";

import { getDb } from "@/db";
import { revokeAccessCode } from "@/modules/public-passport/codes-service";

import { requireApiMember } from "../../../../access/_member";
import { toApiError } from "../../../../_lib/errors";
import { ApiError, json, route } from "../../../../_lib/http";

/** Revoke one of the creator's own codes (anyone using it is locked out at once). */
export const DELETE = route(
  "passport_codes.revoke",
  async (request, ctx: RouteContext<"/api/v1/passport/sharing/codes/[id]">) => {
    const { user } = await requireApiMember(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "No such code.");
    try {
      await revokeAccessCode(getDb(), { userId: user.userId, codeId: id });
      return json({ revoked: true });
    } catch (error) {
      toApiError(error);
    }
  },
);
