import "server-only";

import type { getApplication } from "@/modules/financial-eligibility/application-service";

type App = NonNullable<Awaited<ReturnType<typeof getApplication>>>;

/** API shape of an application: no opaque provider references. */
export function applicationJson(app: App) {
  return {
    id: app.id,
    status: app.status,
    purpose: app.purpose,
    purposes: app.purposes,
    purposeNote: app.purposeNote,
    requestedAmount: app.requestedAmount,
    declaredMonthlyIncome: app.declaredMonthlyIncome,
    declaredMonthlyEmi: app.declaredMonthlyEmi,
    incomeSources: app.incomeSources,
    panMasked: app.panMasked,
    steps: {
      details: app.detailsCompletedAt ? "completed" : "not_started",
      creditCheck: app.bureauStatus,
      bank: app.cashflowStatus,
      /** "Have you shared every account where you receive creator income?" — null until answered. */
      bankCoverageAnswered: app.accountsCompleteDeclared !== null,
      confirmed: app.status !== "draft",
    },
    bankCoverage: app.cashflowCoverage,
    missingAccountsReason: app.missingAccountsReason,
    bureauScoreBand: app.bureauScoreBand,
    cashflowMonths: app.cashflowMonthsCount,
    expiresAt: app.expiresAt,
    inputsReadyAt: app.inputsReadyAt,
    closedAt: app.closedAt,
    inputsErasedAt: app.inputsErasedAt,
    createdAt: app.createdAt,
  };
}
