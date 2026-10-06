import "server-only";

import { redirect } from "next/navigation";
import type { z } from "zod";

import { getDb } from "@/db";
import { fieldErrorsFromZod, formError, readCheckbox, readList, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { ConsentError } from "@/modules/consent";
import {
  OnboardingError,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import type { EditMode } from "@/modules/creator-profile/onboarding-service";
import {
  aboutStepSchema,
  businessStepSchema,
  interestsStepSchema,
  profileStepSchema,
} from "@/modules/creator-profile/schemas";
import { requireCreator } from "@/modules/identity";

/**
 * Shared step handlers for onboarding and Passport editing: authorise → parse
 * → call the domain service. Returns `null` on success so each caller decides
 * where to route. Form payloads are never logged.
 */

const INVALID = "Please check the highlighted fields.";

function invalid(error: z.ZodError, values: FormState["values"]): FormState {
  return formError(INVALID, { fieldErrors: fieldErrorsFromZod(error), values });
}

export function fromDomainError(error: unknown, values: FormState["values"], step: string, mode: EditMode): FormState {
  if (error instanceof OnboardingError) {
    if (error.code === "already_completed") redirect("/dashboard");
    if (error.code === "step_locked" || error.code === "profile_missing")
      redirect(mode === "passport" ? "/dashboard" : "/onboarding");
    const message = error.message !== error.code ? error.message : INVALID;
    return formError(message, { fieldErrors: error.field ? { [error.field]: [message] } : undefined, values });
  }
  if (error instanceof ConsentError) {
    return formError("The consent text has been updated. Please review the latest version and try again.", { values });
  }
  logger.error("profile.step_failed", { step, mode, ...describeError(error) });
  return formError("We couldn't save this. Please try again.", { values });
}

export async function handleAbout(form: FormData, mode: EditMode): Promise<FormState | null> {
  const user = await requireCreator();
  const values = {
    legalName: readText(form, "legalName") ?? "",
    displayName: readText(form, "displayName") ?? "",
    state: readText(form, "state") ?? "",
    city: readText(form, "city") ?? "",
    cityOther: readText(form, "cityOther") ?? "",
    languages: readList(form, "languages"),
    languagesOther: readList(form, "languagesOther"),
  };
  const parsed = aboutStepSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  try {
    await saveAboutStep(getDb(), user.userId, parsed.data, { mode });
  } catch (error) {
    return fromDomainError(error, values, "about", mode);
  }
  return null;
}

export async function handleProfile(form: FormData, mode: EditMode): Promise<FormState | null> {
  const user = await requireCreator();
  const platforms = readList(form, "platforms");
  const platformHandles = Object.fromEntries(platforms.map((p) => [p, readText(form, `handle_${p}`) ?? ""]));
  const values = {
    primaryCreatorHandle: readText(form, "primaryCreatorHandle") ?? "",
    categories: readList(form, "categories"),
    primaryCategory: readText(form, "primaryCategory") ?? "",
    creatorSince: readText(form, "creatorSince") ?? "",
    platforms,
    ...Object.fromEntries(Object.entries(platformHandles).map(([p, h]) => [`handle_${p}`, h])),
  };
  const parsed = profileStepSchema.safeParse({ ...values, platformHandles });
  if (!parsed.success) return invalid(parsed.error, values);
  try {
    await saveProfileStep(getDb(), user.userId, parsed.data, new Date(), { mode });
  } catch (error) {
    return fromDomainError(error, values, "profile", mode);
  }
  return null;
}

export async function handleBusiness(form: FormData, mode: EditMode): Promise<FormState | null> {
  const user = await requireCreator();
  // The GSTIN is deliberately NOT echoed back in form state.
  const values = { legalForm: readText(form, "legalForm") ?? "", gstStatus: readText(form, "gstStatus") ?? "" };
  const parsed = businessStepSchema.safeParse({ ...values, gstin: readText(form, "gstin") });
  if (!parsed.success) return invalid(parsed.error, values);
  try {
    await saveBusinessStep(getDb(), user.userId, parsed.data, { mode });
  } catch (error) {
    return fromDomainError(error, values, "business", mode);
  }
  return null;
}

export async function handleInterests(form: FormData, mode: EditMode): Promise<FormState | null> {
  const user = await requireCreator();
  const values = {
    prInterest: readCheckbox(form, "prInterest"),
    preferredCategories: readList(form, "preferredCategories"),
    brandInterests: readList(form, "brandInterests"),
    travelInterest: readCheckbox(form, "travelInterest"),
  };
  const parsed = interestsStepSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  try {
    await saveInterestsStep(getDb(), user.userId, parsed.data, { mode });
  } catch (error) {
    return fromDomainError(error, values, "interests", mode);
  }
  return null;
}
