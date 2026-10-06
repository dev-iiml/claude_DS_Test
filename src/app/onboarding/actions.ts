"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { formError, readCheckbox, readText, fieldErrorsFromZod, type FormState } from "@/lib/forms";
import { completeOnboarding } from "@/modules/creator-profile/onboarding-service";
import { consentStepSchema } from "@/modules/creator-profile/schemas";
import { requireCreator } from "@/modules/identity";

import { fromDomainError, handleAbout, handleBusiness, handleInterests, handleProfile } from "./_lib/step-handlers";
import { onboardingPath } from "./_lib/steps";

/** Thin onboarding actions: shared step handler, then route to the next step. */

export async function saveAboutAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleAbout(form, "onboarding");
  if (error) return error;
  redirect(onboardingPath("profile"));
}

export async function saveProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleProfile(form, "onboarding");
  if (error) return error;
  redirect(onboardingPath("business"));
}

export async function saveBusinessAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleBusiness(form, "onboarding");
  if (error) return error;
  redirect(onboardingPath("interests"));
}

export async function saveInterestsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleInterests(form, "onboarding");
  if (error) return error;
  redirect(onboardingPath("consent"));
}

export async function completeOnboardingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const parsed = consentStepSchema.safeParse({
    consentDefinitionId: readText(form, "consentDefinitionId"),
    agree: readCheckbox(form, "agree"),
  });
  if (!parsed.success) {
    return formError("Please check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error) });
  }
  try {
    await completeOnboarding(getDb(), user.userId, { consentDefinitionId: parsed.data.consentDefinitionId });
  } catch (error) {
    return fromDomainError(error, {}, "consent", "onboarding");
  }
  redirect("/dashboard?welcome=1");
}
