"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/lib/forms";

import { handleAbout, handleBusiness, handleInterests, handleProfile } from "../onboarding/_lib/step-handlers";

/** Passport editing reuses the onboarding step handlers in `passport` mode. */

export async function updateAboutAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleAbout(form, "passport");
  if (error) return error;
  redirect("/passport?updated=about");
}

export async function updateProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleProfile(form, "passport");
  if (error) return error;
  redirect("/passport?updated=profile");
}

export async function updateBusinessAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleBusiness(form, "passport");
  if (error) return error;
  redirect("/passport?updated=business");
}

export async function updateInterestsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const error = await handleInterests(form, "passport");
  if (error) return error;
  redirect("/passport?updated=interests");
}
