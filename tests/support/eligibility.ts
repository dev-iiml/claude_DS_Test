import type { Database } from "@/db/create-db";
import { confirmApplication } from "@/modules/financial-eligibility/application-service";
import {
  completeCashflowSharing,
  saveBankCoverage,
  startCashflowSharing,
} from "@/modules/financial-eligibility/cashflow-service";
import { MockFinancialDataProvider, mockAccountsFor } from "@/providers/financial-data/mock-financial-data-provider";
import type { FinancialDataProvider } from "@/providers/financial-data/types";

/**
 * Runs one mock Account Aggregator journey: start for a number (or retry a
 * session), then return with the chosen outcome. By default every account the
 * mock discovers for the number is selected.
 */
export async function shareBank(
  db: Database,
  input: {
    userId: string;
    applicationId: string;
    mobile?: string;
    retrySessionId?: string;
    /** Extra numbers "verified inside the AA journey" (last four digits). */
    inJourney?: string[];
    accounts?: string[];
    outcome?: "approved" | "rejected" | "no_accounts";
    financialData?: FinancialDataProvider;
    env?: Record<string, string | undefined>;
    now?: Date;
  },
) {
  const financialData = input.financialData ?? new MockFinancialDataProvider();
  const started = await startCashflowSharing(
    { db, financialData, now: input.now },
    input.retrySessionId
      ? {
          userId: input.userId,
          applicationId: input.applicationId,
          redirectUri: "http://x/cb",
          retrySessionId: input.retrySessionId,
        }
      : {
          userId: input.userId,
          applicationId: input.applicationId,
          redirectUri: "http://x/cb",
          mobile: input.mobile ?? "9876543211",
        },
  );
  const reference = new URL(started.redirectUrl, "http://x").searchParams.get("reference")!;
  const last4 = reference.split("_").at(-2)!;
  const outcome = input.outcome ?? "approved";
  const accounts =
    input.accounts ?? [last4, ...(input.inJourney ?? [])].flatMap((n) => mockAccountsFor(n).map((a) => a.ref));
  const app = await completeCashflowSharing(
    { db, financialData, env: input.env, now: input.now },
    {
      userId: input.userId,
      params: { reference, status: outcome, ...(outcome === "approved" ? { accounts: accounts.join(",") } : {}) },
    },
  );
  return { app, reference, sessionId: started.sessionId };
}

/** Shares a number, answers "every income account is shared", and confirms on Review. */
export async function shareAndConfirm(
  db: Database,
  input: { userId: string; applicationId: string; mobile?: string; allShared?: boolean },
) {
  await shareBank(db, input);
  await saveBankCoverage(
    { db },
    {
      userId: input.userId,
      applicationId: input.applicationId,
      coverage: input.allShared === false ? { allShared: false, missingReason: "bank_not_on_aa" } : { allShared: true },
    },
  );
  return confirmApplication({ db }, { userId: input.userId, applicationId: input.applicationId });
}
