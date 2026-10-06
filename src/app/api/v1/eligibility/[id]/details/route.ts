import { z } from "zod";

import { getDb } from "@/db";
import { getApplication, saveApplicationDetails } from "@/modules/financial-eligibility/application-service";
import { applicationDetailsSchema } from "@/modules/financial-eligibility/schemas";

import { requireApiCreator } from "../../../_lib/auth";
import { ApiError, json, readJson, route } from "../../../_lib/http";
import { toEligibilityApiError } from "../../_errors";
import { applicationJson } from "../../_view";

const amount = z.union([z.number().int().nonnegative(), z.string()]).transform(String);
const body = z
  .object({
    /** Up to three, main one first. (`purpose` — a single value — is still accepted from older app builds.) */
    purposes: z.array(z.string()).optional(),
    purpose: z.string().optional(),
    purposeNote: z.string().nullish(),
    requestedAmount: amount,
    declaredMonthlyIncome: amount,
    declaredMonthlyEmi: amount,
    incomeSources: z.array(z.string()),
  })
  .transform(({ purpose, purposes, purposeNote, ...rest }) => ({
    ...rest,
    purposes: purposes ?? (purpose ? [purpose] : []),
    ...(purposeNote ? { purposeNote } : {}),
  }))
  .pipe(applicationDetailsSchema);

export const PUT = route<RouteContext<"/api/v1/eligibility/[id]/details">>(
  "eligibility.details",
  async (request, ctx) => {
    const user = await requireApiCreator(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Check not found.");
    const details = await readJson(request, body);
    try {
      const db = getDb();
      await saveApplicationDetails({ db }, { userId: user.userId, applicationId: id, details });
      return json(applicationJson((await getApplication(db, { userId: user.userId, applicationId: id }))!));
    } catch (error) {
      toEligibilityApiError(error);
    }
  },
);
