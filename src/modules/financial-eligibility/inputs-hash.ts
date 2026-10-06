import { createHash } from "node:crypto";

import { FIN_ENGINE_VERSION, type FinancialEngineInput } from "./financial-features";

/** SHA-256 over the engine version and canonicalised inputs (order-independent). */
export function hashFinancialInputs(input: FinancialEngineInput): string {
  const normalised = {
    asOf: input.asOf,
    declared: {
      monthlyIncome: input.declared.monthlyIncome,
      monthlyEmi: input.declared.monthlyEmi,
      incomeSources: [...new Set(input.declared.incomeSources)].sort(),
    },
    bureau: input.bureau
      ? {
          scoreBand: input.bureau.scoreBand,
          activeTradelines: input.bureau.activeTradelines,
          delinquentTradelines12m: input.bureau.delinquentTradelines12m,
          enquiries6m: input.bureau.enquiries6m,
        }
      : null,
    cashflow: [...input.cashflow]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => [m.month, m.inflow, m.outflow, m.creatorIncome]),
    coverage: [input.coverage.status, input.coverage.accountsShared, input.coverage.accountsNotReceived],
  };
  return createHash("sha256")
    .update(`${FIN_ENGINE_VERSION}|${JSON.stringify(normalised)}`)
    .digest("hex");
}
