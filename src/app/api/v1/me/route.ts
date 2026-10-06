import { getDb } from "@/db";
import { getOnboardingState } from "@/modules/creator-profile/queries";
import { nextOnboardingStep } from "@/modules/creator-profile/rules";

import { requireApiUser } from "../_lib/auth";
import { json, route } from "../_lib/http";

export const GET = route("me", async (request) => {
  const user = await requireApiUser(request);
  const { profile } = user.role === "creator" ? await getOnboardingState(getDb(), user.userId) : { profile: null };
  return json({
    user: { id: user.userId, email: user.email, role: user.role },
    onboarding:
      user.role === "creator"
        ? {
            status: profile?.profileStatus ?? "not_started",
            nextStep:
              profile?.profileStatus === "completed" ? null : nextOnboardingStep(profile?.lastCompletedStep ?? null),
          }
        : null,
  });
});
