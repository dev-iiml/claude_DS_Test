import { getDb } from "@/db";
import {
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
  type EditMode,
} from "@/modules/creator-profile/onboarding-service";
import { getOnboardingState } from "@/modules/creator-profile/queries";
import {
  aboutStepSchema,
  businessStepSchema,
  interestsStepSchema,
  profileStepSchema,
} from "@/modules/creator-profile/schemas";

import { requireApiCreator } from "../../_lib/auth";
import { toApiError } from "../../_lib/errors";
import { ApiError, noContent, readJson, route } from "../../_lib/http";

/**
 * Saves one profile section. While the profile is a draft this follows
 * onboarding order; once completed it edits the Passport (same validation).
 */
export const PUT = route<RouteContext<"/api/v1/onboarding/[step]">>("onboarding.step", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const { step } = await ctx.params;
  const db = getDb();
  const { profile } = await getOnboardingState(db, user.userId);
  const mode: EditMode = profile?.profileStatus === "completed" ? "passport" : "onboarding";

  try {
    switch (step) {
      case "about":
        await saveAboutStep(db, user.userId, await readJson(request, aboutStepSchema), { mode });
        break;
      case "profile":
        await saveProfileStep(db, user.userId, await readJson(request, profileStepSchema), new Date(), { mode });
        break;
      case "business":
        await saveBusinessStep(db, user.userId, await readJson(request, businessStepSchema), { mode });
        break;
      case "interests":
        await saveInterestsStep(db, user.userId, await readJson(request, interestsStepSchema), { mode });
        break;
      default:
        throw new ApiError(404, "not_found", "Unknown step.");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    toApiError(error);
  }
  return noContent();
});
