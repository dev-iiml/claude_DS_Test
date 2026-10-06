import { z } from "zod";

import { getDb } from "@/db";
import { hasUnderwritingRun } from "@/modules/underwriting/underwriting-service";
import { getCreatorLenderView } from "@/modules/lending";
import {
  closeApplication,
  getApplication,
  getFinancialCapacity,
} from "@/modules/financial-eligibility/application-service";

import { requireApiCreator } from "../../_lib/auth";
import { ApiError, json, noContent, route } from "../../_lib/http";
import { toEligibilityApiError } from "../_errors";
import { applicationJson } from "../_view";

type Ctx = RouteContext<"/api/v1/eligibility/[id]">;

async function idFrom(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
  return id;
}

/** One check with its Financial Capacity features (inputs, not a decision). */
export const GET = route<Ctx>("eligibility.get", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const id = await idFrom(ctx);
  const db = getDb();
  const app = await getApplication(db, { userId: user.userId, applicationId: id });
  if (!app) throw new ApiError(404, "not_found", "Check not found.");
  return json({
    application: applicationJson(app),
    financialCapacity: await getFinancialCapacity(db, { userId: user.userId, applicationId: id }),
    // Creators see that a recommendation exists, not its figures, until a partner lender has reviewed it.
    recommendation: { prepared: await hasUnderwritingRun(db, id) },
    // Partner lender: not_shared · preparing · with_lender · decided (after a CreatorCo review; `simulated` in the pilot).
    lender: await getCreatorLenderView(db, { userId: user.userId, applicationId: id }),
  });
});

/** Closes an open check and erases its financial inputs. */
export const DELETE = route<Ctx>("eligibility.close", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const id = await idFrom(ctx);
  try {
    await closeApplication({ db: getDb() }, { userId: user.userId, applicationId: id });
  } catch (error) {
    toEligibilityApiError(error);
  }
  return noContent();
});
