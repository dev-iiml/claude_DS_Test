"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { formError, readCheckbox, readText, type FormState } from "@/lib/forms";
import { getServerEnv } from "@/lib/env";
import { describeError, logger } from "@/lib/logger";
import { ConsentError } from "@/modules/consent";
import { requireCreator } from "@/modules/identity";
import {
  SocialConnectionError,
  disconnectAccount,
  enableProfessionalAnalytics,
  refreshConnectedAccounts,
  setPrimaryAccount,
  startConnection,
} from "@/modules/social-data/connection-service";
import { getProviders } from "@/modules/integrations/registry";

import { CONNECT_CALLBACK_PATH } from "./connect/constants";

/** Thin actions for Stage 06: authorise → validate → module service → route. */

const startSchema = z.object({
  platform: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  connectionConsentId: z.uuid(),
  agree: z.literal(true, { error: "Please confirm to continue." }),
  analyticsConsentId: z.uuid().nullable(),
  additional: z.boolean(),
});

export async function startConnectionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const parsed = startSchema.safeParse({
    platform: readText(form, "platform"),
    connectionConsentId: readText(form, "connectionConsentId"),
    agree: readCheckbox(form, "agree"),
    analyticsConsentId: readCheckbox(form, "analytics") ? (readText(form, "analyticsConsentId") ?? null) : null,
    additional: readText(form, "additional") === "1",
  });
  if (!parsed.success) {
    const agreeIssue = parsed.error.issues.find((i) => i.path[0] === "agree");
    return formError(agreeIssue ? "Please confirm to continue." : "Please choose a platform.", {
      fieldErrors: agreeIssue ? { agree: ["Please confirm to continue."] } : undefined,
    });
  }

  let url: string;
  try {
    const result = await startConnection(
      { db: getDb(), social: (await getProviders()).social },
      {
        userId: user.userId,
        platform: parsed.data.platform,
        redirectUri: new URL(CONNECT_CALLBACK_PATH, getServerEnv().APP_URL).toString(),
        connectionConsentId: parsed.data.connectionConsentId,
        analyticsConsentId: parsed.data.analyticsConsentId,
        additional: parsed.data.additional,
      },
    );
    url = result.authorizationUrl;
  } catch (error) {
    if (error instanceof SocialConnectionError) {
      if (error.code === "profile_incomplete") redirect("/onboarding");
      return formError(error.message !== error.code ? error.message : "We couldn't start the connection.");
    }
    logger.error("social.connect_start_failed", describeError(error));
    return formError("We couldn't start the connection. Please try again.");
  }
  redirect(url);
}

export async function disconnectAccountAction(form: FormData): Promise<void> {
  const user = await requireCreator();
  const accountId = z.uuid().safeParse(readText(form, "accountId"));
  if (!accountId.success) redirect("/passport");
  try {
    await disconnectAccount(
      { db: getDb(), social: (await getProviders()).social },
      { userId: user.userId, accountId: accountId.data },
    );
  } catch (error) {
    if (!(error instanceof SocialConnectionError)) logger.error("social.disconnect_failed", describeError(error));
    redirect("/passport?connect_error=not_found");
  }
  redirect("/passport?disconnected=1");
}

export async function makePrimaryAccountAction(form: FormData): Promise<void> {
  const user = await requireCreator();
  const accountId = z.uuid().safeParse(readText(form, "accountId"));
  if (!accountId.success) redirect("/passport");
  try {
    await setPrimaryAccount(getDb(), { userId: user.userId, accountId: accountId.data });
  } catch (error) {
    if (!(error instanceof SocialConnectionError)) logger.error("social.make_primary_failed", describeError(error));
  }
  redirect(`/passport/accounts/${accountId.data}`);
}

export async function refreshAccountsAction(): Promise<void> {
  const user = await requireCreator();
  try {
    await refreshConnectedAccounts({ db: getDb(), social: (await getProviders()).social }, { userId: user.userId });
  } catch (error) {
    logger.error("social.refresh_failed", describeError(error));
    redirect("/passport?connect_error=refresh_failed");
  }
  redirect("/passport?refreshed=1");
}

export async function enableSignalsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireCreator();
  const consentId = z.uuid().safeParse(readText(form, "consentDefinitionId"));
  if (!consentId.success || !readCheckbox(form, "agree")) {
    return formError("Please confirm to turn on professional signals.", {
      fieldErrors: { agree: ["Please confirm to turn on professional signals."] },
    });
  }
  try {
    await enableProfessionalAnalytics(getDb(), { userId: user.userId, consentDefinitionId: consentId.data });
  } catch (error) {
    if (error instanceof ConsentError) {
      return formError("The consent text has been updated. Please review the latest version and try again.");
    }
    if (error instanceof SocialConnectionError && error.code === "profile_incomplete") redirect("/onboarding");
    logger.error("graph.enable_failed", describeError(error));
    return formError("We couldn't turn on professional signals. Please try again.");
  }
  redirect("/passport/signals?enabled=1");
}
