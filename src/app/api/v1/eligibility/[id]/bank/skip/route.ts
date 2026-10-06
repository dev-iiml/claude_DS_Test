import { z } from "zod";

import { getDb } from "@/db";
import { getApplication } from "@/modules/financial-eligibility/application-service";
import { skipCashflow } from "@/modules/financial-eligibility/cashflow-service";

import { requireApiCreator } from "../../../../_lib/auth";
import { ApiError, json, route } from "../../../../_lib/http";
import { toEligibilityApiError } from "../../../_errors";
import { applicationJson } from "../../../_view";

/** Continue without bank data. */
export const POST = route<RouteContext<"/api/v1/eligibility/[id]/bank/skip">>(
  "eligibility.bank_skip",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
    try {
      const db = getDb();
      await skipCashflow({ db }, { userId: user.userId, applicationId: id });
      return json(applicationJson((await getApplication(db, { userId: user.userId, applicationId: id }))!));
    } catch (error) {
      toEligibilityApiError(error);
    }
  },
);
