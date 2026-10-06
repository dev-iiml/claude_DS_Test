import { z } from "zod";

import { getDb } from "@/db";
import { getApplication, runBureauCheck } from "@/modules/financial-eligibility/application-service";
import { panSchema } from "@/modules/financial-eligibility/schemas";
import { getProviders } from "@/modules/integrations/registry";

import { requireApiCreator } from "../../../_lib/auth";
import { ApiError, json, readJson, route } from "../../../_lib/http";
import { toEligibilityApiError } from "../../_errors";
import { applicationJson } from "../../_view";

/** Runs the bureau check. The PAN is used once and never stored, logged or returned. */
export const POST = route<RouteContext<"/api/v1/eligibility/[id]/credit-check">>(
  "eligibility.credit_check",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
    const { pan } = await readJson(request, z.object({ pan: panSchema, confirm: z.literal(true) }));
    try {
      const db = getDb();
      await runBureauCheck(
        { db, bureau: (await getProviders()).bureau },
        { userId: user.userId, applicationId: id, pan },
      );
      return json(applicationJson((await getApplication(db, { userId: user.userId, applicationId: id }))!));
    } catch (error) {
      toEligibilityApiError(error);
    }
  },
);
