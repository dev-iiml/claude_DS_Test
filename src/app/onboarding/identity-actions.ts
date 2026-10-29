"use server";

import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import {
  findGstRegistrationsForUser,
  verifyGstinForUser,
  type GstRegistrationView,
} from "@/modules/creator-profile/gst-registration";
import { ConsentError } from "@/modules/consent";
import { requireCreator } from "@/modules/identity";
import { fetchIdentityPrefill } from "@/modules/identity/identity-prefill";
import {
  maskMobile,
  normaliseIndianMobile,
  requestMobileOtp,
  verifyMobileOtp,
} from "@/modules/identity/mobile-verification";
import { getProviders } from "@/modules/integrations/registry";

import { RATE_LIMITED_MESSAGE, clientIp, rateLimit } from "../_lib/rate-limit";

/**
 * Interactive identity actions used by onboarding widgets (called directly,
 * not via form submission). Each one re-authorises the creator. Responses
 * never contain the full PAN.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const fail = (message: string) => ({ ok: false as const, message });

export async function sendOtpAction(
  mobile: string,
): Promise<
  ActionResult<{ challengeId: string; resendAfterSeconds: number; maskedMobile: string; demoCode: string | null }>
> {
  const user = await requireCreator();
  if (!(await rateLimit("otp.send", await clientIp())).ok) return fail(RATE_LIMITED_MESSAGE);
  try {
    const r = await requestMobileOtp(
      { db: getDb(), notifications: (await getProviders()).notifications },
      { userId: user.userId, mobile },
    );
    if (!r.ok) {
      return fail(
        {
          invalid_mobile: "Enter a valid 10-digit Indian mobile number.",
          mobile_in_use: "This number is already verified on another CreatorCo account.",
          too_soon: "Please wait a few seconds before requesting another code.",
          too_many: "Too many codes requested. Please try again in an hour.",
        }[r.reason],
      );
    }
    return {
      ok: true,
      data: {
        challengeId: r.challengeId,
        resendAfterSeconds: r.resendAfterSeconds,
        maskedMobile: maskMobile(normaliseIndianMobile(mobile) ?? ""),
        demoCode: r.mockCode,
      },
    };
  } catch (error) {
    logger.error("identity.otp_send_failed", describeError(error));
    return fail("We couldn't send a code right now. Please try again.");
  }
}

export async function verifyOtpAction(
  challengeId: string,
  code: string,
): Promise<ActionResult<{ maskedMobile: string }>> {
  const user = await requireCreator();
  if (!(await rateLimit("otp.verify", user.userId)).ok) return fail(RATE_LIMITED_MESSAGE);
  try {
    const r = await verifyMobileOtp(
      { db: getDb(), notifications: (await getProviders()).notifications },
      { userId: user.userId, challengeId, code },
    );
    if (!r.ok) {
      return fail(
        {
          not_found: "This code has already been used or doesn't exist. Request a new one.",
          expired: "This code has expired. Request a new one.",
          locked: "Too many incorrect attempts. Request a new code.",
          invalid_code: `That code isn't right.${r.attemptsLeft ? ` ${r.attemptsLeft} attempts left.` : ""}`,
          mobile_in_use: "This number is already verified on another CreatorCo account.",
        }[r.reason],
      );
    }
    return { ok: true, data: { maskedMobile: maskMobile(r.mobile) } };
  } catch (error) {
    logger.error("identity.otp_verify_failed", describeError(error));
    return fail("We couldn't verify the code right now. Please try again.");
  }
}

export async function fetchIdentityPrefillAction(
  consentDefinitionId: string,
): Promise<ActionResult<{ fullName: string; panMasked: string }>> {
  const user = await requireCreator();
  try {
    const r = await fetchIdentityPrefill(
      { db: getDb(), identityLookup: (await getProviders()).identityLookup },
      { userId: user.userId, consentDefinitionId },
    );
    if (!r.ok) {
      return fail(
        {
          mobile_not_verified: "Verify your mobile number first.",
          consent_required: "Please give consent to fetch your details.",
          too_many: "Too many lookups. Please try again in an hour, or type your legal name.",
          not_found: "We couldn't find details for this number. Please type your legal name.",
        }[r.reason],
      );
    }
    return { ok: true, data: r };
  } catch (error) {
    if (error instanceof ConsentError) return fail("The consent text has been updated. Reload the page and try again.");
    logger.error("identity.prefill_failed", describeError(error));
    return fail("We couldn't fetch your details right now. Please type your legal name.");
  }
}

export async function findGstRegistrationsAction(): Promise<ActionResult<{ registrations: GstRegistrationView[] }>> {
  const user = await requireCreator();
  try {
    const p = await getProviders();
    const r = await findGstRegistrationsForUser(
      { db: getDb(), identityLookup: p.identityLookup, taxRegistry: p.taxRegistry },
      user.userId,
    );
    if (!r.ok) {
      return fail(
        {
          mobile_not_verified: "Verify your mobile number on the About you step to look up GST registrations.",
          consent_required: "Fetch your details on the About you step first (it asks for consent).",
          too_many: "Too many lookups. Please try again in an hour, or enter your GSTIN.",
          not_found: "We couldn't find PAN details for your number. Please enter your GSTIN.",
        }[r.reason],
      );
    }
    return { ok: true, data: { registrations: r.registrations } };
  } catch (error) {
    logger.error("gst.lookup_failed", describeError(error));
    return fail("We couldn't look up GST registrations right now. Please enter your GSTIN.");
  }
}

export async function verifyGstinAction(
  gstin: string,
): Promise<ActionResult<{ registration: GstRegistrationView | null }>> {
  const user = await requireCreator();
  try {
    const r = await verifyGstinForUser(
      { db: getDb(), taxRegistry: (await getProviders()).taxRegistry },
      { userId: user.userId, gstin },
    );
    if (!r.ok) {
      return fail(
        r.reason === "invalid_format"
          ? "Enter a valid 15-character GSTIN."
          : "Too many checks. Please try again later.",
      );
    }
    return { ok: true, data: { registration: r.registration } };
  } catch (error) {
    logger.error("gst.verify_failed", describeError(error));
    return fail("We couldn't check this GSTIN right now.");
  }
}
