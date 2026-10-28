"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import { fieldErrorsFromZod, formError, readText, type FormState } from "@/lib/forms";
import {
  AccessError,
  closeOpportunity,
  createOpportunity,
  decideAccessRequest,
  updateOpportunity,
} from "@/modules/access";
import { accessDecisionSchema, opportunityInputSchema } from "@/modules/access/schemas";
import { requirePartnershipsAdmin } from "@/modules/identity";

const idSchema = z.uuid();

/** India time for the desk's date inputs: "2026-10-20T18:00" (IST) → Date. */
function istLocal(value: string | undefined) {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+05:30` : value;
}

function readOpportunity(form: FormData) {
  const raw = {
    brandId: readText(form, "brandId"),
    title: readText(form, "title"),
    kind: readText(form, "kind"),
    category: readText(form, "category"),
    summary: readText(form, "summary"),
    details: readText(form, "details"),
    minTier: readText(form, "minTier"),
    pointsCost: readText(form, "pointsCost"),
    seats: readText(form, "seats"),
    opensAt: istLocal(readText(form, "opensAt")),
    closesAt: istLocal(readText(form, "closesAt")),
    status: readText(form, "status"),
  };
  const values = Object.fromEntries(
    Object.entries({ ...raw, opensAt: readText(form, "opensAt"), closesAt: readText(form, "closesAt") }).map(
      ([k, v]) => [k, v ?? ""],
    ),
  );
  return { parsed: opportunityInputSchema.safeParse(raw), values };
}

function accessFailure(error: unknown, fallback: string, values?: FormState["values"]): FormState {
  if (error instanceof AccessError)
    return formError(error.message !== error.code ? error.message : fallback, { values });
  logger.error("partnerships.action_failed", describeError(error));
  return formError(fallback, { values });
}

export async function createOpportunityAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const { parsed, values } = readOpportunity(form);
  if (!parsed.success)
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  let id: string;
  try {
    id = await createOpportunity(getDb(), { staffUserId: staff.userId, values: parsed.data });
  } catch (error) {
    return accessFailure(error, "We couldn't create the opportunity.", values);
  }
  redirect(`/partnerships/opportunities/${id}?notice=created`);
}

export async function updateOpportunityAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const id = idSchema.safeParse(readText(form, "id"));
  if (!id.success) return formError("Please reload and try again.");
  const { parsed, values } = readOpportunity(form);
  if (!parsed.success)
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  try {
    await updateOpportunity(getDb(), { staffUserId: staff.userId, id: id.data, values: parsed.data });
  } catch (error) {
    return accessFailure(error, "We couldn't save the opportunity.", values);
  }
  redirect(`/partnerships/opportunities/${id.data}?notice=saved`);
}

export async function closeOpportunityAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const id = idSchema.safeParse(readText(form, "id"));
  if (!id.success) return formError("Please reload and try again.");
  try {
    await closeOpportunity(getDb(), { staffUserId: staff.userId, id: id.data });
  } catch (error) {
    return accessFailure(error, "We couldn't close the opportunity.");
  }
  redirect(`/partnerships/opportunities/${id.data}?notice=closed`);
}

export async function decideRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const requestId = idSchema.safeParse(readText(form, "requestId"));
  if (!requestId.success) return formError("Please reload and try again.");
  const decision = accessDecisionSchema.safeParse(
    readText(form, "decision") === "decline"
      ? { decision: "decline", reason: readText(form, "reason") }
      : { decision: readText(form, "decision") },
  );
  if (!decision.success)
    return formError("Choose a reason to decline.", { fieldErrors: fieldErrorsFromZod(decision.error) });
  try {
    await decideAccessRequest(getDb(), {
      staffUserId: staff.userId,
      requestId: requestId.data,
      decision: decision.data,
    });
  } catch (error) {
    return accessFailure(error, "We couldn't record the decision.");
  }
  redirect(
    `/partnerships/requests/${requestId.data}?notice=${decision.data.decision === "approve" ? "approved" : "declined"}`,
  );
}
