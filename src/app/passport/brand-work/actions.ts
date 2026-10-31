"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import { fieldErrorsFromZod, formError, readList, readText, type FormState } from "@/lib/forms";
import {
  BrandWorkError,
  chooseConfirmation,
  createRecord,
  deleteDraft,
  refreshGraphForRecord,
  submitRecord,
  updateRecord,
} from "@/modules/brand-work";
import { CONFIRMATION_METHODS } from "@/modules/brand-work/domain";
import { FREE_TEXT_FIELDS, RESTRICTED_TEXT_MESSAGE, recordInputSchema } from "@/modules/brand-work/schemas";
import { enqueueJob } from "@/modules/jobs";

import { requireMember } from "../../_lib/member";

const idSchema = z.uuid();

function readRecord(form: FormData) {
  const raw = {
    endBrandName: readText(form, "endBrandName") ?? "",
    billedPartyType: readText(form, "billedPartyType") ?? "",
    billedPartyName: readText(form, "billedPartyName") || undefined,
    industryCode: readText(form, "industryCode") || undefined,
    platforms: readList(form, "platforms"),
    deliverables: readList(form, "deliverables"),
    visibility: readText(form, "private") === "on" ? "private" : "show_on_passport",
    description: readText(form, "description") ?? "",
    deliverablesSummary: readText(form, "deliverablesSummary") || undefined,
    workDate: readText(form, "workDate") ?? "",
    invoiceDate: readText(form, "invoiceDate") || undefined,
    invoiceAmountRupees: (readText(form, "invoiceAmountRupees") ?? "").replace(/[,\s₹]/g, "") || undefined,
  };
  const values: FormState["values"] = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v : (v ?? "")]),
  );
  const parsed = recordInputSchema.safeParse(raw);
  // A field flagged for identifiers is never echoed back into form state.
  if (!parsed.success)
    for (const issue of parsed.error.issues)
      if (issue.message === RESTRICTED_TEXT_MESSAGE && FREE_TEXT_FIELDS.includes(issue.path[0] as never))
        values[issue.path[0] as string] = "";
  return { parsed, values };
}

function failure(error: unknown, fallback: string, values?: FormState["values"]): FormState {
  if (error instanceof BrandWorkError)
    return formError(error.message !== error.code ? error.message : fallback, { values });
  logger.error("brand_work.action_failed", describeError(error));
  return formError(fallback, { values });
}

export async function createRecordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const { parsed, values } = readRecord(form);
  if (!parsed.success)
    return formError("Please check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  const consentDefinitionId = readText(form, "agree") === "on" ? (readText(form, "consentDefinitionId") ?? null) : null;
  const limited = await rateLimit("brand_work.create", user.userId);
  if (!limited.ok) return formError("You've added a lot of records today. Please try again tomorrow.", { values });
  let id: string;
  try {
    id = await createRecord(getDb(), {
      userId: user.userId,
      values: parsed.data,
      consentDefinitionId,
      source: "settings",
    });
  } catch (error) {
    if (error instanceof BrandWorkError && error.code === "consent_required")
      return formError(error.message, { fieldErrors: { agree: [error.message] }, values });
    return failure(error, "We couldn't save this record.", values);
  }
  redirect(`/passport/brand-work/${id}?notice=created`);
}

export async function updateRecordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const recordId = idSchema.safeParse(readText(form, "recordId"));
  if (!recordId.success) return formError("Please reload and try again.");
  const { parsed, values } = readRecord(form);
  if (!parsed.success)
    return formError("Please check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  try {
    await updateRecord(getDb(), { userId: user.userId, recordId: recordId.data, values: parsed.data });
  } catch (error) {
    return failure(error, "We couldn't save this record.", values);
  }
  redirect(`/passport/brand-work/${recordId.data}?notice=saved`);
}

export async function submitRecordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const recordId = idSchema.safeParse(readText(form, "recordId"));
  if (!recordId.success) return formError("Please reload and try again.");
  const limited = await rateLimit("brand_work.submit", user.userId);
  if (!limited.ok) return formError("You've sent a lot of records today. Please try again tomorrow.");
  try {
    await submitRecord(getDb(), { userId: user.userId, recordId: recordId.data });
  } catch (error) {
    return failure(error, "We couldn't send this record.");
  }
  redirect(`/passport/brand-work/${recordId.data}?notice=submitted`);
}

export async function deleteDraftAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const recordId = idSchema.safeParse(readText(form, "recordId"));
  if (!recordId.success) return formError("Please reload and try again.");
  try {
    const db = getDb();
    const keys = await deleteDraft(db, { userId: user.userId, recordId: recordId.data });
    for (const k of keys)
      await enqueueJob(db, { type: "brand_work_erase_documents", payload: { key: k.key, provider: k.provider } });
  } catch (error) {
    return failure(error, "We couldn't delete this draft.");
  }
  redirect("/passport/brand-work?notice=deleted");
}

export async function chooseConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const recordId = idSchema.safeParse(readText(form, "recordId"));
  const method = z.enum(CONFIRMATION_METHODS).safeParse(readText(form, "method"));
  if (!recordId.success || !method.success) return formError("Choose how the payment should be confirmed.");
  const consentDefinitionId = readText(form, "agree") === "on" ? (readText(form, "consentDefinitionId") ?? null) : null;
  if (method.data === "aa_match") {
    const limited = await rateLimit("brand_work.payment_check", user.userId);
    if (!limited.ok) return formError("You've run a lot of bank-data checks today. Please try again tomorrow.");
  }
  let notice = "requested";
  try {
    const db = getDb();
    const result = await chooseConfirmation(db, {
      userId: user.userId,
      recordId: recordId.data,
      method: method.data,
      consentDefinitionId,
      source: "settings",
    });
    if (result.match) {
      notice = `match_${result.match}`;
      if (result.match === "seen") await refreshGraphForRecord(db, recordId.data);
    }
  } catch (error) {
    if (error instanceof BrandWorkError && error.code === "consent_required")
      return formError(error.message, { fieldErrors: { agree: [error.message] } });
    return failure(error, "We couldn't record your choice.");
  }
  redirect(`/passport/brand-work/${recordId.data}?notice=${notice}`);
}
