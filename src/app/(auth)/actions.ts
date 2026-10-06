"use server";

import { redirect } from "next/navigation";

import { fieldErrorsFromZod, formError, readText, type FormState } from "@/lib/forms";
import { authDeps } from "@/modules/identity";
import { signIn, signOut, signUpCreator, LOGIN_WINDOW_MINUTES } from "@/modules/identity/auth/auth-service";
import { signInSchema, signUpSchema } from "@/modules/identity/auth/schemas";
import { getDb } from "@/db";
import { isOnboardingComplete } from "@/modules/creator-profile/queries";
import { postSignInPath } from "@/modules/identity/policy";
import { clearSessionCookie, readSessionToken, writeSessionCookie } from "@/modules/identity/session-cookie";

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    email: readText(form, "email"),
    password: readText(form, "password"),
    confirmPassword: readText(form, "confirmPassword"),
  });
  const values = { email: readText(form, "email") ?? "" };
  if (!parsed.success) {
    return formError("Please check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  }

  const result = await signUpCreator(authDeps(), parsed.data);
  if (!result.ok) {
    return formError("An account with this email already exists. Sign in instead.", {
      fieldErrors: { email: ["An account with this email already exists."] },
      values,
    });
  }

  await writeSessionCookie(result.session.token, result.session.expiresAt);
  redirect("/onboarding");
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ email: readText(form, "email"), password: readText(form, "password") });
  const values = { email: readText(form, "email") ?? "" };
  if (!parsed.success) {
    return formError("Please check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  }

  const result = await signIn(authDeps(), parsed.data);
  if (!result.ok) {
    const message =
      result.reason === "locked"
        ? `Too many attempts. Please wait ${LOGIN_WINDOW_MINUTES} minutes and try again.`
        : result.reason === "inactive"
          ? "This account is not active. Please contact CreatorCo support."
          : "That email and password don't match our records.";
    return formError(message, { values });
  }

  await writeSessionCookie(result.session.token, result.session.expiresAt);
  const onboardingComplete =
    result.user.role === "creator" ? await isOnboardingComplete(getDb(), result.user.userId) : false;
  redirect(postSignInPath({ role: result.user.role, onboardingComplete }, readText(form, "next")));
}

export async function signOutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await signOut(authDeps(), token);
  await clearSessionCookie();
  redirect("/login");
}
