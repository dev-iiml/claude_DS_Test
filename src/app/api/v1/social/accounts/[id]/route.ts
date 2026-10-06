import { z } from "zod";

import { getDb } from "@/db";
import { disconnectAccount } from "@/modules/social-data/connection-service";
import { getProviders } from "@/modules/integrations/registry";

import { requireApiCreator } from "../../../_lib/auth";
import { toApiError } from "../../../_lib/errors";
import { ApiError, noContent, route } from "../../../_lib/http";

export const DELETE = route<RouteContext<"/api/v1/social/accounts/[id]">>(
  "social.accounts.delete",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Account not found.");
    try {
      await disconnectAccount(
        { db: getDb(), social: (await getProviders()).social },
        { userId: user.userId, accountId: id },
      );
    } catch (error) {
      toApiError(error);
    }
    return noContent();
  },
);
