"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { logger, describeError } from "@/lib/logger";
import { formError, readCheckbox, readText, type FormState } from "@/lib/forms";
import { AccessError, cancelAccessRequest, requestAccess } from "@/modules/access";
import { requestNoteSchema } from "@/modules/access/schemas";
import { requireCreator } from "@/modules/identity";

import { RATE_LIMITED_MESSAGE, rateLimit } from "../_lib/rate-limit";

const idSchema = z.uuid();

/** Request an opportunity (Stage 14). Agreeing to the brand opportunities consent happens on the same screen. */
export async function requestAccessAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const opportunityId = idSchema.safeParse(readText(form, "opportunityId"));
  if (!opportunityId.success) return formError("Please reload and try again.");
  const note = requestNoteSchema.safeParse(readText(form, "note") ?? "");
  const values = { note: readText(form, "note") ?? "" };
  if (!note.success)
    return formError("Check your note.", { fieldErrors: { note: [note.error.issues[0]!.message] }, values });
  const definition = readText(form, "consentDefinitionId");
  let consentDefinitionId: string | null = null;
  if (definition) {
    const parsed = idSchema.safeParse(definition);
    if (!parsed.success) return formError("Please reload and try again.");
    if (!readCheckbox(form, "agree"))
      return formError("Agree to the brand opportunities consent to request access.", {
        fieldErrors: { agree: ["Tick the box to continue."] },
        values,
      });
    consentDefinitionId = parsed.data;
  }
  if (!(await rateLimit("access.request", user.userId)).ok) return formError(RATE_LIMITED_MESSAGE, { values });
  try {
    await requestAccess(getDb(), {
      userId: user.userId,
      opportunityId: opportunityId.data,
      note: note.data,
      consentDefinitionId,
      source: "settings",
    });
  } catch (error) {
    if (error instanceof AccessError)
      return formError(error.message !== error.code ? error.message : "This can't be requested right now.", { values });
    logger.error("access.request_failed", describeError(error));
    return formError("We couldn't send your request. Please try again.", { values });
  }
  redirect(`/access/${opportunityId.data}?notice=requested`);
}

export async function cancelAccessRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const requestId = idSchema.safeParse(readText(form, "requestId"));
  const opportunityId = idSchema.safeParse(readText(form, "opportunityId"));
  if (!requestId.success || !opportunityId.success) return formError("Please reload and try again.");
  try {
    await cancelAccessRequest(getDb(), { userId: user.userId, requestId: requestId.data });
  } catch (error) {
    if (error instanceof AccessError)
      return formError(error.message !== error.code ? error.message : "This request can't be cancelled now.");
    logger.error("access.cancel_failed", describeError(error));
    return formError("We couldn't cancel your request. Please try again.");
  }
  redirect(`/access/${opportunityId.data}?notice=cancelled`);
}
