import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import { FinancialEligibilityError } from "@/modules/financial-eligibility/application-service";
import { completeCashflowSharing } from "@/modules/financial-eligibility/cashflow-service";
import { requireCreator } from "@/modules/identity";
import { getProviderByKey, getProviders } from "@/modules/integrations/registry";

/** Redirect parameters passed through to the provider adapter (bounded; values never logged). */
function boundedParams(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of request.nextUrl.searchParams) {
    if (Object.keys(out).length >= 12) break;
    if (/^[a-z_]{1,32}$/i.test(k) && v.length <= 500) out[k] = v;
  }
  return out;
}

/**
 * Account Aggregator return leg. The reference must belong to a session on one
 * of this creator's open checks. The creator always lands back on the bank
 * step, which shows what each account delivered.
 */
export async function GET(request: NextRequest) {
  const user = await requireCreator();
  let next: string;
  try {
    const app = await completeCashflowSharing(
      {
        db: getDb(),
        financialData: (await getProviders()).financialData,
        financialDataFor: (key: string) => getProviderByKey("financial_data", key),
      },
      { userId: user.userId, params: boundedParams(request) },
    );
    next = `/eligibility/${app.id}/bank`;
  } catch (error) {
    if (error instanceof FinancialEligibilityError && error.applicationId) {
      redirect(`/eligibility/${error.applicationId}/bank?error=${error.code}`);
    }
    if (!(error instanceof FinancialEligibilityError))
      logger.error("eligibility.bank_callback_failed", describeError(error));
    redirect("/eligibility");
  }
  redirect(next);
}
