import { z } from "zod";

import { getDb } from "@/db";
import { underwriteIfReady } from "@/app/eligibility/_lib/underwrite";
import { confirmApplication, getApplication } from "@/modules/financial-eligibility/application-service";

import { requireApiCreator } from "../../../_lib/auth";
import { ApiError, json, route } from "../../../_lib/http";
import { toEligibilityApiError } from "../../_errors";
import { applicationJson } from "../../_view";

/** Review → confirm: computes Financial Capacity from the confirmed inputs and prepares the recommendation. */
export const POST = route<RouteContext<"/api/v1/eligibility/[id]/confirm">>(
  "eligibility.confirm",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
    try {
      const db = getDb();
      const app = await confirmApplication({ db }, { userId: user.userId, applicationId: id });
      await underwriteIfReady(user.userId, app);
      return json(applicationJson((await getApplication(db, { userId: user.userId, applicationId: id }))!));
    } catch (error) {
      toEligibilityApiError(error);
    }
  },
);
