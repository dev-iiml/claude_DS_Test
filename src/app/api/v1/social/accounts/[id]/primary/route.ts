import { z } from "zod";

import { getDb } from "@/db";
import { setPrimaryAccount } from "@/modules/social-data/connection-service";

import { requireApiCreator } from "../../../../_lib/auth";
import { toApiError } from "../../../../_lib/errors";
import { ApiError, noContent, route } from "../../../../_lib/http";

/** Makes a connected account the creator's primary one on its platform. */
export const POST = route<RouteContext<"/api/v1/social/accounts/[id]/primary">>(
  "social.accounts.primary",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Account not found.");
    try {
      await setPrimaryAccount(getDb(), { userId: user.userId, accountId: id });
    } catch (error) {
      toApiError(error);
    }
    return noContent();
  },
);
