"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { clientIp, rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { formError, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { isSecureCookieEnv } from "@/lib/env";
import { brandUnlock } from "@/modules/brand-orgs/access-service";
import { BrandOrgError } from "@/modules/brand-orgs/errors";
import { getMembership } from "@/modules/brand-orgs/org-service";
import { getCurrentUser, requireVerifiedBrandMember } from "@/modules/identity";
import { isBrandMemberRole } from "@/modules/identity/policy";
import { redeemAccessCode } from "@/modules/public-passport/codes-service";
import { REPORT_REASON_CODES } from "@/modules/public-passport/domain";
import { ipPseudonym, unlockCookieName } from "@/modules/public-passport/keys";
import { reportPassport } from "@/modules/public-passport/moderation-service";
import { resolvePassportSlug } from "@/modules/public-passport/page-service";

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/);

async function livePassport(slug: string | undefined) {
  const s = slugSchema.safeParse(slug);
  if (!s.success) return null;
  const r = await resolvePassportSlug(getDb(), s.data);
  return r.kind === "live" ? r.passport : null;
}

const UNLOCK_MESSAGES = {
  wrong: "That code didn't work. Check it and try again.",
  locked_out: "Too many attempts from your network. Try again in 15 minutes.",
  expired: "That code has expired or been revoked. Ask the creator for a new one.",
  unavailable: "Unlocking isn't available for this page right now.",
} as const;

/** Public: redeem a creator's access code (a network is locked out for 15 minutes after 20 attempts; the creator is told about bursts of wrong codes). */
export async function unlockWithCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const slug = readText(form, "slug");
  const passport = await livePassport(slug);
  if (!passport) return formError(UNLOCK_MESSAGES.unavailable);
  const code = readText(form, "code") ?? "";
  if (code.replace(/[\s-]/g, "").length < 8)
    return formError("Enter the access code.", { fieldErrors: { code: ["Enter the access code."] } });
  const ip = await clientIp();
  if (!(await rateLimit("passport.code_attempt", ip)).ok) return formError(UNLOCK_MESSAGES.locked_out);
  const user = await getCurrentUser();
  // A code scoped to an organisation works only for a signed-in member of that organisation while it is verified.
  const membership = user && isBrandMemberRole(user.role) ? await getMembership(getDb(), user.userId) : null;
  const viewerOrgId = membership?.orgStatus === "verified" ? membership.orgId : null;
  const result = await redeemAccessCode(getDb(), {
    passportId: passport.id,
    code,
    viewerName: readText(form, "name") ?? null,
    viewerCompany: readText(form, "company") ?? null,
    viewerOrgId,
    ipPseudonym: ipPseudonym(ip),
  });
  if (!result.ok) return formError(UNLOCK_MESSAGES[result.reason]);
  (await cookies()).set(unlockCookieName(passport.id), result.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieEnv(),
    path: "/p",
    expires: result.expiresAt,
  });
  redirect(`/p/${passport.slug}`);
}

/** A verified brand member unlocks for their organisation (counts against the daily quota). */
export async function brandUnlockAction(_prev: FormState, form: FormData): Promise<FormState> {
  const member = await requireVerifiedBrandMember();
  const passport = await livePassport(readText(form, "slug"));
  if (!passport) return formError(UNLOCK_MESSAGES.unavailable);
  if (!(await rateLimit("brand.unlock", member.userId)).ok) return formError("Too many unlocks. Try again later.");
  try {
    await brandUnlock(getDb(), {
      userId: member.userId,
      passportId: passport.id,
      ipPseudonym: ipPseudonym(await clientIp()),
    });
  } catch (error) {
    if (error instanceof BrandOrgError)
      return formError(error.message !== error.code ? error.message : UNLOCK_MESSAGES.unavailable);
    logger.error("passport.brand_unlock_failed", describeError(error));
    return formError(UNLOCK_MESSAGES.unavailable);
  }
  redirect(`/p/${passport.slug}`);
}

/** Public: "Report this page" — a reason code and the passport id only. */
export async function reportPassportAction(_prev: FormState, form: FormData): Promise<FormState> {
  const passport = await livePassport(readText(form, "slug"));
  if (!passport) return formError("This page isn't available.");
  const reason = z.enum(REPORT_REASON_CODES).safeParse(readText(form, "reason"));
  if (!reason.success) return formError("Choose a reason.", { fieldErrors: { reason: ["Choose a reason."] } });
  if (!(await rateLimit("passport.report", await clientIp())).ok)
    return formError("Too many reports. Try again later.");
  await reportPassport(getDb(), { passportId: passport.id, reason: reason.data });
  redirect(`/p/${passport.slug}?reported=1`);
}
