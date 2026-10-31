"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import { formError, readText, type FormState } from "@/lib/forms";
import {
  assignRecord,
  BrandWorkError,
  addAlias,
  createBrand,
  decideMerge,
  decideReversal,
  issueDocumentUrl,
  proposeMerge,
  proposeReversal,
  recordStaffPaymentConfirmation,
  refreshGraphForRecord,
  rejectRecord,
  requestInfo,
  resolveRecordBrand,
  setIndustry,
  verifyRecord,
} from "@/modules/brand-work";
import { getDocumentStorageKey } from "@/modules/brand-work/documents-service";
import { requireBrandWorkReviewer } from "@/modules/identity";
import { resolveProviderByKey } from "@/modules/integrations/router";
import { getServerEnv } from "@/lib/env";

const id = z.uuid();

function failure(error: unknown, fallback: string): FormState {
  if (error instanceof BrandWorkError) return formError(error.message !== error.code ? error.message : fallback);
  logger.error("brand_work.staff_action_failed", describeError(error));
  return formError(fallback);
}

const recordUrl = (recordId: string, notice: string) => `/brand-work/records/${recordId}?notice=${notice}`;

/** Starts a review: locks the record to this reviewer for 30 minutes (an explicit POST, never on page view). */
export async function startReviewAction(form: FormData) {
  const staff = await requireBrandWorkReviewer();
  const recordId = id.safeParse(readText(form, "recordId"));
  if (!recordId.success) redirect("/brand-work");
  try {
    await assignRecord(getDb(), { reviewerId: staff.userId, recordId: recordId.data });
  } catch (error) {
    if (!(error instanceof BrandWorkError)) logger.error("brand_work.assign_failed", describeError(error));
    redirect(recordUrl(recordId.data, error instanceof BrandWorkError ? error.code : "failed"));
  }
  redirect(recordUrl(recordId.data, "started"));
}

export async function resolveBrandAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const recordId = id.safeParse(readText(form, "recordId"));
  if (!recordId.success) return formError("Please reload and try again.");
  try {
    await resolveRecordBrand(getDb(), {
      staffId: staff.userId,
      recordId: recordId.data,
      directoryId: readText(form, "directoryId") || null,
      newBrandName: readText(form, "newBrandName") || null,
      industryCode: readText(form, "industryCode") ?? "",
    });
  } catch (error) {
    return failure(error, "We couldn't confirm the brand.");
  }
  redirect(recordUrl(recordId.data, "brand_resolved"));
}

export async function verifyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const recordId = id.safeParse(readText(form, "recordId"));
  if (!recordId.success) return formError("Please reload and try again.");
  let status: string;
  try {
    const counterparties = (readText(form, "counterparties") ?? "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    const db = getDb();
    status = (
      await verifyRecord(db, {
        reviewerId: staff.userId,
        recordId: recordId.data,
        documentCounterparties: counterparties,
        note: readText(form, "note") ?? null,
      })
    ).status;
    if (status === "verified") await refreshGraphForRecord(db, recordId.data);
  } catch (error) {
    return failure(error, "We couldn't verify this record.");
  }
  redirect(recordUrl(recordId.data, status));
}

export async function negativeDecisionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const recordId = id.safeParse(readText(form, "recordId"));
  const decision = readText(form, "decision");
  const reasonCode = readText(form, "reasonCode") ?? "";
  if (!recordId.success || (decision !== "request_info" && decision !== "reject"))
    return formError("Please reload and try again.");
  if (!reasonCode) return formError("Choose a reason.", { fieldErrors: { reasonCode: ["Choose a reason."] } });
  try {
    const input = {
      reviewerId: staff.userId,
      recordId: recordId.data,
      reasonCode,
      note: readText(form, "note") ?? null,
    };
    if (decision === "reject") await rejectRecord(getDb(), input);
    else await requestInfo(getDb(), input);
  } catch (error) {
    return failure(error, "We couldn't record the decision.");
  }
  redirect(recordUrl(recordId.data, decision));
}

export async function paymentConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const recordId = id.safeParse(readText(form, "recordId"));
  const method = z.enum(["agency_confirmation", "remittance_advice"]).safeParse(readText(form, "method"));
  if (!recordId.success || !method.success) return formError("Choose how the payment was confirmed.");
  try {
    const db = getDb();
    await recordStaffPaymentConfirmation(db, {
      reviewerId: staff.userId,
      recordId: recordId.data,
      method: method.data,
      month: readText(form, "month") ?? "",
      note: readText(form, "note") ?? null,
    });
    await refreshGraphForRecord(db, recordId.data);
  } catch (error) {
    return failure(error, "We couldn't confirm the payment.");
  }
  redirect(recordUrl(recordId.data, "payment_confirmed"));
}

export async function proposeReversalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const recordId = id.safeParse(readText(form, "recordId"));
  const reasonCode = readText(form, "reasonCode") ?? "";
  if (!recordId.success) return formError("Please reload and try again.");
  if (!reasonCode)
    return formError("A reversal needs a reason.", { fieldErrors: { reasonCode: ["Choose a reason."] } });
  try {
    await proposeReversal(getDb(), { reviewerId: staff.userId, recordId: recordId.data, reasonCode });
  } catch (error) {
    return failure(error, "We couldn't propose the reversal.");
  }
  redirect(recordUrl(recordId.data, "reversal_proposed"));
}

export async function decideReversalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const reversalId = id.safeParse(readText(form, "reversalId"));
  const recordId = readText(form, "recordId") ?? "";
  const decision = readText(form, "decision");
  if (!reversalId.success || (decision !== "approve" && decision !== "decline"))
    return formError("Please reload and try again.");
  try {
    const db = getDb();
    await decideReversal(db, { reviewerId: staff.userId, reversalId: reversalId.data, decision });
    if (decision === "approve" && id.safeParse(recordId).success) await refreshGraphForRecord(db, recordId);
  } catch (error) {
    return failure(error, "We couldn't record the decision.");
  }
  redirect(`/brand-work/reversals?notice=${decision === "approve" ? "approved" : "declined"}`);
}

/** Issues a short-lived signed link (audited) and sends the reviewer to it. */
export async function viewDocumentAction(form: FormData) {
  const staff = await requireBrandWorkReviewer();
  const documentId = id.safeParse(readText(form, "documentId"));
  if (!documentId.success) redirect("/brand-work");
  const db = getDb();
  // The storage config is the document's own, never taken from the form.
  const provider = await getDocumentStorageKey(db, documentId.data);
  if (!provider) redirect("/brand-work");
  const storage = await resolveProviderByKey(
    { db, production: getServerEnv().APP_ENV === "production" },
    "document_storage",
    provider,
  );
  if (!storage) redirect("/brand-work?notice=storage_unavailable");
  let url: string;
  try {
    url = (await issueDocumentUrl({ db, storage }, { reviewerId: staff.userId, documentId: documentId.data })).url;
  } catch (error) {
    if (!(error instanceof BrandWorkError)) logger.error("brand_work.document_url_failed", describeError(error));
    redirect(`/brand-work?notice=${error instanceof BrandWorkError ? error.code : "storage_unavailable"}`);
  }
  redirect(url);
}

// ── Directory ───────────────────────────────────────────────────────────────

export async function createBrandAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  try {
    await createBrand(getDb(), {
      staffId: staff.userId,
      name: readText(form, "name") ?? "",
      industryCode: readText(form, "industryCode") ?? "",
    });
  } catch (error) {
    return failure(error, "We couldn't add the brand.");
  }
  redirect("/brand-work/directory?notice=created");
}

export async function directoryEditAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const directoryId = id.safeParse(readText(form, "directoryId"));
  if (!directoryId.success) return formError("Please reload and try again.");
  try {
    const alias = readText(form, "alias");
    const industry = readText(form, "industryCode");
    const mergeInto = readText(form, "mergeInto");
    if (alias) await addAlias(getDb(), { staffId: staff.userId, directoryId: directoryId.data, alias });
    if (industry)
      await setIndustry(getDb(), { staffId: staff.userId, directoryId: directoryId.data, industryCode: industry });
    if (mergeInto) await proposeMerge(getDb(), { staffId: staff.userId, fromId: directoryId.data, intoId: mergeInto });
  } catch (error) {
    return failure(error, "We couldn't save that.");
  }
  redirect("/brand-work/directory?notice=saved");
}

export async function decideMergeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireBrandWorkReviewer();
  const mergeId = id.safeParse(readText(form, "mergeId"));
  const decision = readText(form, "decision");
  if (!mergeId.success || (decision !== "approve" && decision !== "decline"))
    return formError("Please reload and try again.");
  try {
    await decideMerge(getDb(), { staffId: staff.userId, mergeId: mergeId.data, decision });
  } catch (error) {
    return failure(error, "We couldn't record the decision.");
  }
  redirect(`/brand-work/directory?notice=merge_${decision === "approve" ? "approved" : "declined"}`);
}
