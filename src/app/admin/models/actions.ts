"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { formError, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { requireAdmin } from "@/modules/identity";
import { LenderPolicyError, decidePolicy, proposePolicy } from "@/modules/lending";

/** Simulated lender policy: propose (any risk admin), approve/reject (a different one). */

const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? NaN : Number(v.replace(/[,\s₹]/g, "")));

export async function proposePolicyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const rules = {
    decisionBasis: readText(form, "decisionBasis"),
    minGrade: readText(form, "minGrade"),
    maxExposure: num(readText(form, "maxExposure")),
    maxTenorMonths: num(readText(form, "maxTenorMonths")),
    maxDelinquencies12m: num(readText(form, "maxDelinquencies12m")),
    minBankCoverage: readText(form, "minBankCoverage"),
    minCompleteness: num(readText(form, "minCompletenessPct")) / 100,
    pricing: {
      annualRatePctByGrade: {
        A: num(readText(form, "rateA")),
        B: num(readText(form, "rateB")),
        C: num(readText(form, "rateC")),
        D: num(readText(form, "rateD")),
        E: num(readText(form, "rateE")),
      },
      processingFeePct: num(readText(form, "processingFeePct")),
      offerValidDays: num(readText(form, "offerValidDays")),
      coolingOffDays: num(readText(form, "coolingOffDays")),
    },
  };
  try {
    await proposePolicy(getDb(), { staffId: admin.userId, rules, note: readText(form, "note") ?? null });
  } catch (error) {
    if (error instanceof LenderPolicyError) return formError(`Not valid: ${error.message}`);
    logger.error("lending.policy_propose_failed", describeError(error));
    return formError("Couldn't save the proposal. Please try again.");
  }
  revalidatePath("/admin/models");
  return { status: "idle", message: "Proposed. A different risk admin has to approve it." };
}

export async function decidePolicyAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(readText(form, "policyId"));
  if (!id.success) return;
  try {
    await decidePolicy(getDb(), {
      staffId: admin.userId,
      policyId: id.data,
      approve: readText(form, "decision") === "approve",
    });
  } catch (error) {
    if (!(error instanceof LenderPolicyError)) logger.error("lending.policy_decide_failed", describeError(error));
  }
  revalidatePath("/admin/models");
}
