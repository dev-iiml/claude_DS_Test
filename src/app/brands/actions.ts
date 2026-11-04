"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { fieldErrorsFromZod, formError, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { requestClaim } from "@/modules/brand-orgs/claims-service";
import { BrandOrgError } from "@/modules/brand-orgs/errors";
import {
  acceptBrandTerms,
  acceptInvite,
  inviteMember,
  removeMember,
  revokeInvite,
} from "@/modules/brand-orgs/org-service";
import { brandSignupSchema, completeBrandSignup, requestBrandEmailCode } from "@/modules/brand-orgs/signup-service";
import { authDeps, requireBrandMember, requireVerifiedBrandMember } from "@/modules/identity";
import { writeSessionCookie } from "@/modules/identity/session-cookie";
import { getProviders } from "@/modules/integrations/registry";

import { RATE_LIMITED_MESSAGE, clientIp, rateLimit } from "../_lib/rate-limit";

/**
 * The brand app (Stage 19). Sign-up and invitation acceptance are public
 * entry points (rate limited by IP). GSTIN, passwords and codes are never
 * echoed back into form state.
 */

function failure(error: unknown, fallback: string, values?: FormState["values"]): FormState {
  if (error instanceof BrandOrgError)
    return formError(error.message !== error.code ? error.message : fallback, { values });
  logger.error("brand_app.action_failed", describeError(error));
  return formError(fallback, { values });
}

// ── Sign-up ─────────────────────────────────────────────────────────────────

export async function requestBrandCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = (readText(form, "email") ?? "").trim().toLowerCase();
  const values = { email };
  if (!z.email().safeParse(email).success)
    return formError("Enter your work email address.", {
      fieldErrors: { email: ["Enter your work email address."] },
      values,
    });
  if (!(await rateLimit("brand.signup_code", await clientIp())).ok) return formError(RATE_LIMITED_MESSAGE, { values });
  let challengeId: string;
  try {
    const r = await requestBrandEmailCode(
      { db: getDb(), notifications: (await getProviders()).notifications },
      { email },
    );
    challengeId = r.challengeId;
  } catch (error) {
    if (
      error instanceof BrandOrgError &&
      (error.code === "free_mail" || error.code === "email_taken" || error.code === "invalid")
    )
      return formError(error.message, { fieldErrors: { email: [error.message] }, values });
    return failure(error, "We couldn't send a code. Please try again.", values);
  }
  redirect(`/brands/signup/details?c=${challengeId}`);
}

const SIGNUP_ECHO = ["legalName", "orgType", "website", "identifierType", "identifierValue"] as const;

export async function completeBrandSignupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = {
    challengeId: readText(form, "challengeId") ?? "",
    code: readText(form, "code") ?? "",
    password: readText(form, "password") ?? "",
    legalName: readText(form, "legalName") ?? "",
    orgType: readText(form, "orgType") ?? "",
    website: readText(form, "website") ?? "",
    identifierType: readText(form, "identifierType") ?? "",
    identifierValue: readText(form, "identifierValue") ?? "",
    gstin: readText(form, "gstin") ?? "",
    acceptTerms: readText(form, "acceptTerms") === "on",
  };
  // GSTIN, password and the code are never echoed back.
  const values = Object.fromEntries(SIGNUP_ECHO.map((k) => [k, raw[k]]));
  const parsed = brandSignupSchema.safeParse(raw);
  if (!parsed.success)
    return formError("Please check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  if (!(await rateLimit("brand.signup", await clientIp())).ok) return formError(RATE_LIMITED_MESSAGE, { values });
  let session: { token: string; expiresAt: Date };
  try {
    session = (await completeBrandSignup({ auth: authDeps() }, parsed.data)).session;
  } catch (error) {
    if (error instanceof BrandOrgError && error.code === "code_invalid")
      return formError(error.message, { fieldErrors: { code: [error.message] }, values });
    if (error instanceof BrandOrgError && error.code === "identifier_taken")
      return formError(error.message, { fieldErrors: { identifierValue: [error.message] }, values });
    return failure(error, "We couldn't create your account.", values);
  }
  await writeSessionCookie(session.token, session.expiresAt);
  redirect("/brands?welcome=1");
}

export async function acceptInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = readText(form, "token") ?? "";
  if (!(await rateLimit("brand.signup", await clientIp())).ok) return formError(RATE_LIMITED_MESSAGE);
  let session: { token: string; expiresAt: Date };
  try {
    const r = await acceptInvite(
      { auth: authDeps() },
      { token, password: readText(form, "password") ?? "", acceptTerms: readText(form, "acceptTerms") === "on" },
    );
    session = r.session;
  } catch (error) {
    return failure(error, "We couldn't accept this invitation.");
  }
  await writeSessionCookie(session.token, session.expiresAt);
  redirect("/brands?welcome=1");
}

// ── Members ─────────────────────────────────────────────────────────────────

export async function acceptTermsAction(): Promise<void> {
  const user = await requireBrandMember();
  await acceptBrandTerms(getDb(), { userId: user.userId });
  revalidatePath("/brands");
  redirect("/brands?notice=terms");
}

export type InviteState = FormState & { mockLink?: string | null };

export async function inviteMemberAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const user = await requireBrandMember();
  const email = (readText(form, "email") ?? "").trim().toLowerCase();
  const values = { email };
  if (!z.email().safeParse(email).success) return formError("Enter their work email address.", { values });
  if (!(await rateLimit("brand.invite", user.userId)).ok) return formError(RATE_LIMITED_MESSAGE, { values });
  try {
    const r = await inviteMember(
      { db: getDb(), notifications: (await getProviders()).notifications, appUrl: getServerEnv().APP_URL },
      { userId: user.userId, email },
    );
    revalidatePath("/brands/organisation");
    return { status: "idle", message: `Invitation sent to ${email}.`, mockLink: r.mockLink };
  } catch (error) {
    return failure(error, "We couldn't send the invitation.", values);
  }
}

const idSchema = z.uuid();

export async function removeMemberAction(form: FormData): Promise<void> {
  const user = await requireBrandMember();
  const id = idSchema.safeParse(readText(form, "memberId"));
  let notice = "removed";
  if (id.success) {
    try {
      await removeMember(getDb(), { userId: user.userId, memberId: id.data });
    } catch (error) {
      if (!(error instanceof BrandOrgError)) logger.error("brand_app.remove_failed", describeError(error));
      notice = "remove_failed";
    }
  }
  revalidatePath("/brands/organisation");
  redirect(`/brands/organisation?notice=${notice}`);
}

export async function revokeInviteAction(form: FormData): Promise<void> {
  const user = await requireBrandMember();
  const id = idSchema.safeParse(readText(form, "inviteId"));
  if (id.success) {
    try {
      await revokeInvite(getDb(), { userId: user.userId, inviteId: id.data });
    } catch (error) {
      if (!(error instanceof BrandOrgError)) logger.error("brand_app.revoke_invite_failed", describeError(error));
    }
  }
  revalidatePath("/brands/organisation");
  redirect("/brands/organisation?notice=invite_revoked");
}

// ── Brand directory claims ──────────────────────────────────────────────────

export async function requestClaimAction(form: FormData): Promise<void> {
  const user = await requireVerifiedBrandMember();
  const id = idSchema.safeParse(readText(form, "directoryId"));
  let notice = "claimed";
  if (!id.success) notice = "claim_failed";
  else {
    try {
      await requestClaim(getDb(), { userId: user.userId, directoryId: id.data });
    } catch (error) {
      if (!(error instanceof BrandOrgError)) logger.error("brand_app.claim_failed", describeError(error));
      notice = error instanceof BrandOrgError && error.code === "wrong_state" ? "claim_exists" : "claim_failed";
    }
  }
  revalidatePath("/brands/organisation");
  redirect(`/brands/organisation?notice=${notice}#claims`);
}
