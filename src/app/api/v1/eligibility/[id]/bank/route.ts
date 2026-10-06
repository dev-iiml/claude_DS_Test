import { z } from "zod";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import {
  capabilitiesOf,
  getBankOverview,
  maxNumbersFor,
  startCashflowSharing,
} from "@/modules/financial-eligibility/cashflow-service";
import { aaMobileSchema } from "@/modules/financial-eligibility/schemas";
import { getProviders } from "@/modules/integrations/registry";

import { BANK_CALLBACK_PATH } from "@/app/eligibility/_lib/constants";

import { requireApiCreator } from "../../../_lib/auth";
import { ApiError, json, readJson, route } from "../../../_lib/http";
import { toEligibilityApiError } from "../../_errors";

type Ctx = RouteContext<"/api/v1/eligibility/[id]/bank">;

async function idFrom(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
  return id;
}

/** Numbers searched (last four digits), accounts and their status, coverage, and what the aggregator supports. */
export const GET = route<Ctx>("eligibility.bank_overview", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const id = await idFrom(ctx);
  const provider = (await getProviders()).financialData;
  const overview = await getBankOverview(getDb(), {
    userId: user.userId,
    applicationId: id,
    currentProvider: provider.descriptor.key,
  });
  if (!overview) throw new ApiError(404, "not_found", "Check not found.");
  return json({
    ...overview,
    maxNumbers: maxNumbersFor(provider),
    capabilities: capabilitiesOf(provider),
    mode: provider.descriptor.mode,
  });
});

/**
 * Starts Account Aggregator sharing for a mobile number, or retries an earlier
 * number (`retrySessionId`). Open `redirectUrl` in a system browser sheet.
 */
export const POST = route<Ctx>("eligibility.bank_start", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const id = await idFrom(ctx);
  const body = await readJson(
    request,
    z.union([z.object({ mobile: aaMobileSchema }), z.object({ retrySessionId: z.uuid() })]),
  );
  try {
    const result = await startCashflowSharing(
      { db: getDb(), financialData: (await getProviders()).financialData },
      {
        userId: user.userId,
        applicationId: id,
        redirectUri: new URL(BANK_CALLBACK_PATH, getServerEnv().APP_URL).toString(),
        ...("mobile" in body ? { mobile: body.mobile } : { retrySessionId: body.retrySessionId }),
      },
    );
    return json(result, 201);
  } catch (error) {
    toEligibilityApiError(error);
  }
});
