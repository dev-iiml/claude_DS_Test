import { and, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import {
  bureauSummaries,
  cashflowAccountMonths,
  cashflowAccounts,
  cashflowMonths,
  cashflowSessions,
  creditApplications,
  fiTransactions,
  fiVendorAnalytics,
  financialFeatureRuns,
  financialFeatures,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { eraseLenderRecords } from "@/modules/lending/erasure";
import { eraseUnderwritingRuns } from "@/modules/underwriting/erasure";

/**
 * Erases the financial inputs of a creator's applications (all, or one, or
 * those created up to `before`). Applications sent to a lender are kept —
 * they follow the lender's retention rules (retention hold) — unless listed
 * in `releasedSubmitted`: sent checks whose lender relationship has closed
 * (Stage 13), whose lender records are then erased too.
 * The application row stays as a tombstone with its status and timestamps.
 * Must run inside a transaction (feature rows are append-only otherwise).
 */
export async function eraseFinancialInputs(
  tx: DbExecutor,
  input: { userId: string; applicationId?: string; before?: Date; now: Date; releasedSubmitted?: string[] },
): Promise<Record<string, number>> {
  const apps = await tx
    .select({ id: creditApplications.id, status: creditApplications.status })
    .from(creditApplications)
    .where(
      and(
        eq(creditApplications.userId, input.userId),
        input.releasedSubmitted?.length
          ? or(ne(creditApplications.status, "submitted"), inArray(creditApplications.id, input.releasedSubmitted))
          : ne(creditApplications.status, "submitted"),
        isNull(creditApplications.inputsErasedAt),
        input.applicationId ? eq(creditApplications.id, input.applicationId) : undefined,
        input.before ? lte(creditApplications.createdAt, input.before) : undefined,
      ),
    );
  if (!apps.length) return { applications: 0 };
  const ids = apps.map((a) => a.id);
  const lender = await eraseLenderRecords(
    tx,
    apps.filter((a) => a.status === "submitted").map((a) => a.id),
  );

  const bureau = await tx
    .delete(bureauSummaries)
    .where(inArray(bureauSummaries.applicationId, ids))
    .returning({ id: bureauSummaries.applicationId });
  const months = await tx
    .delete(cashflowMonths)
    .where(inArray(cashflowMonths.applicationId, ids))
    .returning({ id: cashflowMonths.applicationId });
  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const lineItems = await tx
    .delete(fiTransactions)
    .where(inArray(fiTransactions.applicationId, ids))
    .returning({ id: fiTransactions.id });
  await tx.delete(fiVendorAnalytics).where(inArray(fiVendorAnalytics.applicationId, ids));
  const features = await tx
    .delete(financialFeatures)
    .where(inArray(financialFeatures.applicationId, ids))
    .returning({ id: financialFeatures.id });
  await tx.delete(financialFeatureRuns).where(inArray(financialFeatureRuns.applicationId, ids));
  await tx.execute(sql`set local creatorco.erasure = 'off'`);
  await tx.delete(cashflowAccountMonths).where(inArray(cashflowAccountMonths.applicationId, ids));
  const accounts = await tx
    .delete(cashflowAccounts)
    .where(inArray(cashflowAccounts.applicationId, ids))
    .returning({ id: cashflowAccounts.id });
  await tx.delete(cashflowSessions).where(inArray(cashflowSessions.applicationId, ids));
  const underwriting = await eraseUnderwritingRuns(tx, {
    userId: input.userId,
    applicationIds: ids,
    includeSubmitted: true, // vetted above
  });
  await tx
    .update(creditApplications)
    .set({
      requestedAmount: null,
      declaredMonthlyIncome: null,
      declaredMonthlyEmi: null,
      incomeSources: [],
      panMasked: null,
      panFingerprint: null,
      purposeNote: null,
      accountsCompleteDeclared: null,
      missingAccountsReason: null,
      cashflowCoverage: null,
      financialRunId: null,
      inputsErasedAt: input.now,
    })
    .where(inArray(creditApplications.id, ids));
  return {
    applications: ids.length,
    credit_summaries: bureau.length,
    cashflow_months: months.length,
    shared_accounts: accounts.length,
    line_items: lineItems.length,
    features: features.length,
    ...underwriting,
    ...(lender.proposals ? { lender_proposals: lender.proposals } : {}),
  };
}
