"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { formError, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { requireAdmin } from "@/modules/identity";
import {
  DECISION_OUTCOMES,
  LendingError,
  raiseDecisionQuery,
  withdrawDecisionQuery,
  releaseHeldProposal,
  retryProposal,
  reviewDecision,
} from "@/modules/lending";
import { deliverPartnerWebhooks } from "@/modules/partners";

import { lendingDeps } from "@/app/_lib/lending";

/** Risk-console actions on credit proposals. Reasons are stored; nothing financial is logged. */

const idSchema = z.uuid();

function fromError(error: unknown): FormState {
  if (error instanceof LendingError)
    return formError(error.message !== error.code ? error.message : "That isn't possible now.");
  logger.error("lending.staff_action_failed", describeError(error));
  return formError("Something went wrong. Please try again.");
}

export async function releaseProposalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(readText(form, "proposalId"));
  if (!id.success) redirect("/admin/proposals");
  try {
    await releaseHeldProposal(await lendingDeps(), {
      staffId: admin.userId,
      proposalId: id.data,
      reason: readText(form, "reason") ?? "",
    });
  } catch (error) {
    return fromError(error);
  }
  await announce();
  revalidatePath(`/admin/proposals/${id.data}`);
  redirect(`/admin/proposals/${id.data}`);
}

export async function retryProposalAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(readText(form, "proposalId"));
  if (!id.success) redirect("/admin/proposals");
  try {
    await retryProposal(await lendingDeps(), { staffId: admin.userId, proposalId: id.data });
  } catch (error) {
    if (!(error instanceof LendingError)) logger.error("lending.retry_failed", describeError(error));
  }
  await announce();
  redirect(`/admin/proposals/${id.data}`);
}

const rupees = z
  .string()
  .trim()
  .transform((v) => v.replace(/[,\s₹]/g, ""))
  .pipe(z.string().regex(/^\d{0,8}$/))
  .transform((v) => (v ? Number(v) : null));

export async function reviewDecisionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(readText(form, "proposalId"));
  if (!id.success) redirect("/admin/proposals");
  const action = readText(form, "action") === "override" ? "override" : "confirm";
  const outcome = z.enum(DECISION_OUTCOMES).safeParse(readText(form, "outcome"));
  const exposure = rupees.safeParse(readText(form, "exposure") ?? "");
  const tenor = rupees.safeParse(readText(form, "tenorMonths") ?? "");
  if (action === "override" && (!outcome.success || !exposure.success || !tenor.success)) {
    return formError("Check the final outcome, amount and tenor.");
  }
  try {
    await reviewDecision(getDb(), {
      staffId: admin.userId,
      proposalId: id.data,
      decisionId: readText(form, "decisionId") ?? "",
      action,
      outcome: outcome.success ? outcome.data : undefined,
      exposure: exposure.success ? exposure.data : null,
      tenorMonths: tenor.success ? tenor.data : null,
      reason: readText(form, "reason") ?? null,
    });
  } catch (error) {
    return fromError(error);
  }
  await announce();
  revalidatePath(`/admin/proposals/${id.data}`);
  redirect(`/admin/proposals/${id.data}`);
}

/** Stage 12b: question a partner lender's decision (the partner answers with a revision). */
export async function raiseQueryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(readText(form, "proposalId"));
  if (!id.success) redirect("/admin/proposals");
  try {
    await raiseDecisionQuery(getDb(), {
      staffId: admin.userId,
      proposalId: id.data,
      decisionId: readText(form, "decisionId") ?? "",
      message: readText(form, "message") ?? "",
    });
  } catch (error) {
    return fromError(error);
  }
  await announce();
  revalidatePath(`/admin/proposals/${id.data}`);
  redirect(`/admin/proposals/${id.data}`);
}

/** Withdraw an unanswered query (the partner is unresponsive); the decision can then be confirmed. */
export async function withdrawQueryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(readText(form, "proposalId"));
  if (!id.success) redirect("/admin/proposals");
  try {
    await withdrawDecisionQuery(getDb(), {
      staffId: admin.userId,
      proposalId: id.data,
      reason: readText(form, "reason") ?? "",
    });
  } catch (error) {
    return fromError(error);
  }
  await announce();
  revalidatePath(`/admin/proposals/${id.data}`);
  redirect(`/admin/proposals/${id.data}`);
}

/**
 * Immediate webhook delivery after a staff action, run after the response so a
 * slow partner endpoint never holds up the console (the scheduled job retries).
 */
async function announce() {
  after(async () => {
    try {
      await deliverPartnerWebhooks({ db: getDb() }, 10);
    } catch (error) {
      logger.error("lending.webhook_kick_failed", describeError(error));
    }
  });
}
