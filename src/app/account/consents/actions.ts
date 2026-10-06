"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { formError, readCheckbox, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { ConsentError } from "@/modules/consent";
import { WITHDRAWAL_REASONS } from "@/modules/consent/domain";
import { requireCreator } from "@/modules/identity";
import { PrivacyError, grantPurpose, purposeFor, withdrawPurpose } from "@/modules/privacy";

/** Consent centre actions: authorise → validate → privacy service → route. */

const keySchema = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);

export async function grantPurposeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const key = keySchema.safeParse(readText(form, "key"));
  const definitionId = z.uuid().safeParse(readText(form, "consentDefinitionId"));
  if (!key.success || !definitionId.success || !purposeFor(key.data)) return formError("Please reload and try again.");
  if (!readCheckbox(form, "agree")) {
    return formError("Tick the box to give this consent.", {
      fieldErrors: { agree: ["Tick the box to give this consent."] },
    });
  }
  try {
    await grantPurpose(
      { db: getDb() },
      { userId: user.userId, key: key.data, consentDefinitionId: definitionId.data, source: "settings" },
    );
  } catch (error) {
    if (error instanceof ConsentError)
      return formError("This text has been updated. Please review the latest version.");
    if (error instanceof PrivacyError && error.code === "profile_required") redirect("/onboarding");
    logger.error("consent.grant_failed", describeError(error));
    return formError("We couldn't record your consent. Please try again.");
  }
  redirect(`/account/consents/${key.data}?granted=1`);
}

export async function withdrawPurposeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const key = keySchema.safeParse(readText(form, "key"));
  if (!key.success || !purposeFor(key.data)) return formError("Please reload and try again.");
  const reasonRaw = readText(form, "reason");
  const reason = z.enum(WITHDRAWAL_REASONS).safeParse(reasonRaw);
  if (reasonRaw && !reason.success) return formError("Please choose a reason from the list, or none.");
  try {
    await withdrawPurpose(
      { db: getDb() },
      { userId: user.userId, key: key.data, reason: reason.success ? reason.data : null, source: "settings" },
    );
  } catch (error) {
    if (error instanceof PrivacyError && error.code === "not_granted") redirect(`/account/consents/${key.data}`);
    logger.error("consent.withdraw_failed", describeError(error));
    return formError("We couldn't record your withdrawal. Please try again.");
  }
  redirect(purposeFor(key.data)!.core ? "/paused" : `/account/consents/${key.data}?withdrawn=1`);
}
