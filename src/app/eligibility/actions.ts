"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { fieldErrorsFromZod, formError, readCheckbox, readList, readText, type FormState } from "@/lib/forms";
import { getServerEnv } from "@/lib/env";
import { describeError, logger } from "@/lib/logger";
import { ConsentError } from "@/modules/consent";
import {
  FinancialEligibilityError,
  closeApplication,
  confirmApplication,
  runBureauCheck,
  saveApplicationDetails,
  startApplication,
} from "@/modules/financial-eligibility/application-service";
import { saveBankCoverage, skipCashflow, startCashflowSharing } from "@/modules/financial-eligibility/cashflow-service";
import {
  aaMobileSchema,
  applicationDetailsSchema,
  bankCoverageSchema,
  panSchema,
} from "@/modules/financial-eligibility/schemas";
import { requireCreator } from "@/modules/identity";
import { LendingError, acceptOffer, declineOffer, proposeIfShared } from "@/modules/lending";
import { PrivacyError, grantPurpose } from "@/modules/privacy";
import { CONSENT_KEYS } from "@/modules/consent";
import { getProviders } from "@/modules/integrations/registry";

import { BANK_CALLBACK_PATH } from "./_lib/constants";
import { stepPath } from "./_lib/steps";
import { underwriteIfReady } from "./_lib/underwrite";
import { lendingDeps } from "../_lib/lending";

/**
 * Thin eligibility actions. Amounts, the PAN, mobile numbers and the purpose
 * note are never logged; the PAN and mobile numbers are never echoed back in
 * form state.
 */

const idSchema = z.uuid();

function fromError(error: unknown, values: FormState["values"] = {}): FormState {
  if (error instanceof FinancialEligibilityError) {
    if (error.code === "profile_inactive") redirect("/dashboard");
    if (error.code === "consent_required") redirect("/eligibility/start");
    if (error.code === "not_found") redirect("/eligibility");
    return formError(error.message !== error.code ? error.message : "Something isn't right. Please try again.", {
      values,
    });
  }
  if (error instanceof ConsentError)
    return formError("The consent text has been updated. Please review it and try again.");
  logger.error("eligibility.action_failed", describeError(error));
  return formError("We couldn't save this. Please try again.", { values });
}

export async function startEligibilityAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const definitionId = idSchema.safeParse(readText(form, "consentDefinitionId"));
  if (!definitionId.success) return formError("Please reload and try again.");
  if (!readCheckbox(form, "agree")) {
    return formError("Tick the box to give this consent.", {
      fieldErrors: { agree: ["Tick the box to give this consent."] },
    });
  }
  let next: string;
  try {
    const app = await startApplication(
      { db: getDb() },
      { userId: user.userId, consentDefinitionId: definitionId.data, source: "settings" },
    );
    next = stepPath(app);
  } catch (error) {
    return fromError(error);
  }
  redirect(next);
}

export async function saveDetailsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  const values = {
    purposes: readList(form, "purposes"),
    purposeNote: readText(form, "purposeNote") ?? "",
    requestedAmount: readText(form, "requestedAmount") ?? "",
    declaredMonthlyIncome: readText(form, "declaredMonthlyIncome") ?? "",
    declaredMonthlyEmi: readText(form, "declaredMonthlyEmi") ?? "",
    incomeSources: readList(form, "incomeSources"),
  };
  const parsed = applicationDetailsSchema.safeParse(values);
  if (!parsed.success) {
    return formError("Please check the highlighted fields.", { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  }
  let next: string;
  try {
    const app = await saveApplicationDetails(
      { db: getDb() },
      { userId: user.userId, applicationId: applicationId.data, details: parsed.data },
    );
    next = stepPath(app);
  } catch (error) {
    return fromError(error, values);
  }
  redirect(next);
}

export async function creditCheckAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  if (!readCheckbox(form, "confirm")) {
    return formError("Please confirm this is your PAN.", {
      fieldErrors: { confirm: ["Please confirm this is your PAN."] },
    });
  }
  const pan = panSchema.safeParse(readText(form, "pan"));
  if (!pan.success)
    return formError("Please check your PAN.", { fieldErrors: { pan: pan.error.issues.map((i) => i.message) } });
  let next: string;
  try {
    const app = await runBureauCheck(
      { db: getDb(), bureau: (await getProviders()).bureau },
      { userId: user.userId, applicationId: applicationId.data, pan: pan.data },
    );
    next = stepPath(app);
  } catch (error) {
    return fromError(error);
  }
  redirect(next);
}

const bankCallback = () => new URL(BANK_CALLBACK_PATH, getServerEnv().APP_URL).toString();

/** Starts Account Aggregator sharing for a mobile number (the AA verifies it by OTP). */
export async function startBankSharingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  const mobile = aaMobileSchema.safeParse(readText(form, "mobile") ?? "");
  if (!mobile.success) {
    const message = mobile.error.issues[0]?.message ?? "Enter a mobile number.";
    return formError(message, { fieldErrors: { mobile: [message] } });
  }
  let url: string;
  try {
    const r = await startCashflowSharing(
      { db: getDb(), financialData: (await getProviders()).financialData },
      { userId: user.userId, applicationId: applicationId.data, redirectUri: bankCallback(), mobile: mobile.data },
    );
    url = r.redirectUrl;
  } catch (error) {
    if (error instanceof FinancialEligibilityError && error.code !== "profile_inactive" && error.code !== "not_found")
      return formError(error.message !== error.code ? error.message : "We couldn't start sharing. Please try again.");
    if (!(error instanceof FinancialEligibilityError)) {
      logger.error("eligibility.bank_start_failed", describeError(error));
      return formError("We couldn't reach the Account Aggregator. Please try again.");
    }
    return fromError(error);
  }
  redirect(url);
}

/** Tries an earlier number again (missing accounts, a declined or unfinished journey). */
export async function retryBankSharingAction(form: FormData): Promise<void> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  const sessionId = idSchema.safeParse(readText(form, "sessionId"));
  if (!applicationId.success || !sessionId.success) redirect("/eligibility");
  let url: string;
  try {
    const r = await startCashflowSharing(
      { db: getDb(), financialData: (await getProviders()).financialData },
      {
        userId: user.userId,
        applicationId: applicationId.data,
        redirectUri: bankCallback(),
        retrySessionId: sessionId.data,
      },
    );
    url = r.redirectUrl;
  } catch (error) {
    if (!(error instanceof FinancialEligibilityError))
      logger.error("eligibility.bank_retry_failed", describeError(error));
    const code = error instanceof FinancialEligibilityError ? error.code : "start_failed";
    redirect(`/eligibility/${applicationId.data}/bank?error=${code}`);
  }
  redirect(url);
}

/** "Have you shared every account where you receive creator income?" */
export async function saveCoverageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  const answer = readText(form, "allShared");
  const values = { allShared: answer ?? "", missingReason: readText(form, "missingReason") ?? "" };
  if (answer !== "yes" && answer !== "no") {
    return formError("Please answer this question.", {
      fieldErrors: { allShared: ["Please answer this question."] },
      values,
    });
  }
  const parsed = bankCoverageSchema.safeParse(
    answer === "yes" ? { allShared: true } : { allShared: false, missingReason: values.missingReason || undefined },
  );
  if (!parsed.success) {
    return formError("Tell us why some accounts are missing.", {
      fieldErrors: { missingReason: ["Tell us why some accounts are missing."] },
      values,
    });
  }
  let next: string;
  try {
    const app = await saveBankCoverage(
      { db: getDb() },
      { userId: user.userId, applicationId: applicationId.data, coverage: parsed.data },
    );
    next = stepPath(app);
  } catch (error) {
    return fromError(error, values);
  }
  redirect(next);
}

export async function skipBankAction(form: FormData): Promise<void> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  let next: string;
  try {
    const app = await skipCashflow({ db: getDb() }, { userId: user.userId, applicationId: applicationId.data });
    next = stepPath(app);
  } catch (error) {
    if (!(error instanceof FinancialEligibilityError)) logger.error("eligibility.skip_failed", describeError(error));
    next = `/eligibility/${applicationId.data}/bank`;
  }
  redirect(next);
}

/** Review → confirm: computes Financial Capacity from the confirmed inputs and prepares the recommendation. */
export async function confirmCheckAction(form: FormData): Promise<void> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  let next: string;
  try {
    const app = await confirmApplication({ db: getDb() }, { userId: user.userId, applicationId: applicationId.data });
    await underwriteIfReady(user.userId, app);
    next = `/eligibility/${app.id}`;
  } catch (error) {
    if (error instanceof FinancialEligibilityError && error.code === "consent_required") redirect("/eligibility/start");
    if (!(error instanceof FinancialEligibilityError)) logger.error("eligibility.confirm_failed", describeError(error));
    next = `/eligibility/${applicationId.data}/review?error=1`;
  }
  redirect(next);
}

/** Discards a check at the creator's request; its financial inputs are erased straight away. */
export async function discardCheckAction(form: FormData): Promise<void> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  try {
    await closeApplication({ db: getDb() }, { userId: user.userId, applicationId: applicationId.data });
  } catch (error) {
    if (!(error instanceof FinancialEligibilityError)) logger.error("eligibility.discard_failed", describeError(error));
  }
  redirect("/eligibility?discarded=1");
}

/** Prepares the recommendation again (e.g. after creator signals changed). Idempotent. */
export async function prepareRecommendationAction(form: FormData): Promise<void> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) redirect("/eligibility");
  await underwriteIfReady(user.userId, { id: applicationId.data, status: "inputs_ready" });
  redirect(`/eligibility/${applicationId.data}`);
}

/** "Share with a partner lender": records the consent, then prepares (and usually sends) the proposal. */
export async function shareWithLenderAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  const definitionId = idSchema.safeParse(readText(form, "consentDefinitionId"));
  if (!applicationId.success || !definitionId.success) return formError("Please reload and try again.");
  if (!readCheckbox(form, "agree")) {
    return formError("Tick the box to give this consent.", {
      fieldErrors: { agree: ["Tick the box to give this consent."] },
    });
  }
  try {
    await grantPurpose(
      { db: getDb() },
      {
        userId: user.userId,
        key: CONSENT_KEYS.lenderSharing,
        consentDefinitionId: definitionId.data,
        source: "settings",
      },
    );
  } catch (error) {
    if (error instanceof ConsentError)
      return formError("The consent text has been updated. Please reload and review it.");
    if (error instanceof PrivacyError) return formError("This consent can't be given right now.");
    logger.error("eligibility.share_failed", describeError(error));
    return formError("We couldn't save this. Please try again.");
  }
  try {
    await proposeIfShared(await lendingDeps(), { userId: user.userId, applicationId: applicationId.data });
  } catch (error) {
    // The consent is recorded; the scheduled sweep prepares the proposal.
    logger.error("lending.propose_failed", describeError(error));
  }
  redirect(`/eligibility/${applicationId.data}`);
}

/**
 * Stage 13: accept the reviewed offer. Gives the "Continue with the partner
 * lender" consent (shown with the offer), then records the acceptance of the
 * exact terms on screen. The partner lender takes it from there.
 */
export async function acceptOfferAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  const definitionId = idSchema.safeParse(readText(form, "consentDefinitionId"));
  const termsHash = z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .safeParse(readText(form, "termsHash"));
  if (!applicationId.success || !definitionId.success || !termsHash.success)
    return formError("Please reload and try again.");
  const fieldErrors: Record<string, string[]> = {};
  if (!readCheckbox(form, "kfs")) fieldErrors.kfs = ["Confirm you've read the Key Fact Statement."];
  if (!readCheckbox(form, "agree")) fieldErrors.agree = ["Tick the box to continue with the partner lender."];
  if (Object.keys(fieldErrors).length) return formError("Please confirm both to accept.", { fieldErrors });
  try {
    await acceptOffer(getDb(), {
      userId: user.userId,
      applicationId: applicationId.data,
      termsHash: termsHash.data,
      kfsAcknowledged: true,
      consentDefinitionId: definitionId.data,
      source: "settings",
    });
  } catch (error) {
    if (error instanceof LendingError)
      return formError(error.message !== error.code ? error.message : "This offer can't be accepted right now.");
    logger.error("lending.accept_failed", describeError(error));
    return formError("We couldn't record your answer. Please try again.");
  }
  redirect(`/eligibility/${applicationId.data}`);
}

export async function declineOfferAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const applicationId = idSchema.safeParse(readText(form, "applicationId"));
  if (!applicationId.success) return formError("Please reload and try again.");
  try {
    await declineOffer(getDb(), {
      userId: user.userId,
      applicationId: applicationId.data,
      reason: readText(form, "reason") ?? null,
    });
  } catch (error) {
    if (error instanceof LendingError)
      return formError(error.message !== error.code ? error.message : "This offer can't be declined right now.");
    logger.error("lending.decline_failed", describeError(error));
    return formError("We couldn't record your answer. Please try again.");
  }
  redirect(`/eligibility/${applicationId.data}`);
}
