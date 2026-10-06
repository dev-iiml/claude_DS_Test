import { z } from "zod";

import { getDb } from "@/db";
import { getApplication } from "@/modules/financial-eligibility/application-service";
import { saveBankCoverage } from "@/modules/financial-eligibility/cashflow-service";
import { bankCoverageSchema } from "@/modules/financial-eligibility/schemas";

import { requireApiCreator } from "../../../../_lib/auth";
import { ApiError, json, readJson, route } from "../../../../_lib/http";
import { toEligibilityApiError } from "../../../_errors";
import { applicationJson } from "../../../_view";

/** "Have you shared every account where you receive creator income?" `{ allShared, missingReason? }` */
export const PUT = route<RouteContext<"/api/v1/eligibility/[id]/bank/coverage">>(
  "eligibility.bank_coverage",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
    const coverage = await readJson(request, bankCoverageSchema);
    try {
      const db = getDb();
      await saveBankCoverage({ db }, { userId: user.userId, applicationId: id, coverage });
      return json(applicationJson((await getApplication(db, { userId: user.userId, applicationId: id }))!));
    } catch (error) {
      toEligibilityApiError(error);
    }
  },
);
