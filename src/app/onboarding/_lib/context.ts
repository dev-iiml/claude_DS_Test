import "server-only";

import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { canAccessStep, nextOnboardingStep } from "@/modules/creator-profile/rules";
import { getOnboardingState } from "@/modules/creator-profile/queries";
import { requireCreator } from "@/modules/identity";

import { onboardingPath, type OnboardingRouteStep } from "./steps";

/**
 * Authorises and loads an onboarding step. Completed creators go to the
 * dashboard; creators cannot jump ahead of the next incomplete step.
 */
export async function loadOnboardingStep(step: OnboardingRouteStep) {
  const user = await requireCreator();
  const state = await getOnboardingState(getDb(), user.userId);

  if (state.profile?.profileStatus === "completed") redirect("/dashboard");
  if (state.profile && state.profile.profileStatus !== "draft") redirect("/dashboard");

  const last = state.profile?.lastCompletedStep ?? null;
  if (step !== "welcome" && !canAccessStep(step, last)) redirect(onboardingPath(nextOnboardingStep(last)));

  return { user, ...state };
}

/** Where a creator should resume onboarding. */
export async function resumePath(): Promise<string> {
  const user = await requireCreator();
  const { profile } = await getOnboardingState(getDb(), user.userId);
  if (!profile) return onboardingPath("welcome");
  if (profile.profileStatus !== "draft") return "/dashboard";
  return onboardingPath(nextOnboardingStep(profile.lastCompletedStep));
}
