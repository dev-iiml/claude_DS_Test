import { z } from "zod";

import { getDb } from "@/db";
import { completeCashflowSharing } from "@/modules/financial-eligibility/cashflow-service";
import { getApplication } from "@/modules/financial-eligibility/application-service";
import { getProviderByKey, getProviders } from "@/modules/integrations/registry";

import { requireApiCreator } from "../../../_lib/auth";
import { json, readJson, route } from "../../../_lib/http";
import { toEligibilityApiError } from "../../_errors";
import { applicationJson } from "../../_view";

const params = z
  .record(z.string().regex(/^[a-z_]{1,32}$/i), z.string().max(500))
  .refine((p) => Object.keys(p).length <= 12);

/** Completes Account Aggregator sharing: pass the redirect's query parameters as `params`. */
export const POST = route("eligibility.bank_complete", async (request) => {
  const user = await requireApiCreator(request);
  const input = await readJson(request, z.object({ params }));
  try {
    const db = getDb();
    const app = await completeCashflowSharing(
      {
        db,
        financialData: (await getProviders()).financialData,
        financialDataFor: (key: string) => getProviderByKey("financial_data", key),
      },
      { userId: user.userId, params: input.params },
    );
    return json(applicationJson((await getApplication(db, { userId: user.userId, applicationId: app.id }))!));
  } catch (error) {
    toEligibilityApiError(error);
  }
});
