import { getDb } from "@/db";
import { completeOnboarding } from "@/modules/creator-profile/onboarding-service";
import { consentStepSchema } from "@/modules/creator-profile/schemas";

import { requireApiCreator } from "../../_lib/auth";
import { toApiError } from "../../_lib/errors";
import { noContent, readJson, route } from "../../_lib/http";

/** Final step: records the creator-profile consent and completes onboarding. */
export const POST = route("onboarding.complete", async (request) => {
  const user = await requireApiCreator(request);
  const input = await readJson(request, consentStepSchema);
  try {
    await completeOnboarding(getDb(), user.userId, { consentDefinitionId: input.consentDefinitionId });
  } catch (error) {
    toApiError(error);
  }
  return noContent();
});
