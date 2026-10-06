import { describe, expect, it } from "vitest";

import {
  analyseCashflow,
  combineAccountMonths,
  type AnalysisAccount,
  type AnalysisTxn,
} from "@/modules/financial-eligibility/cashflow-analysis";
import { normaliseAccounts } from "@/modules/financial-eligibility/cashflow-service";
import {
  mayRetainLineItems,
  openFiText,
  sealFiText,
  txnRefHash,
} from "@/modules/financial-eligibility/fi-data-protection";

let n = 0;
const txn = (bookedOn: string, amount: number, direction: "credit" | "debit", narration: string, mode = "neft") =>
  ({ ref: `t${n++}`, bookedOn, amount, direction, mode, narration, counterparty: null }) satisfies AnalysisTxn;
const account = (key: string, maskedNumber: string, transactions: AnalysisTxn[]): AnalysisAccount => ({
  key,
  maskedNumber,
  transactions,
});

describe("cashflow analysis cfa-0.1.0", () => {
  it("counts only credits that look like creator income", () => {
    const r = analyseCashflow([
      account("a", "XXXX1111", [
        txn("2026-05-07", 40_000, "credit", "NEFT-GOOGLE ASIA PACIFIC-ADSENSE PAYOUT"),
        txn("2026-05-15", 50_000, "credit", "NEFT-BRAND COLLAB-KITE COLLECTIVE"),
        txn("2026-05-20", 5_000, "credit", "IMPS-AFFILIATE COMMISSION"),
        txn("2026-05-10", 5_000, "credit", "CASH DEP BRANCH", "cash"),
        txn("2026-05-18", 1_200, "credit", "UPI/REFUND/ONLINE ORDER", "upi"),
        txn("2026-05-19", 3_000, "credit", "UPI/GIFT/FAMILY", "upi"),
        txn("2026-05-21", 900, "credit", "BRAND PAYMENT REVERSAL"),
        txn("2026-05-01", 20_000, "debit", "UPI/RENT", "upi"),
      ]),
    ]);
    const [m] = r.accounts[0]!.months;
    expect(m).toMatchObject({
      month: "2026-05",
      creatorIncome: 95_000,
      inflow: 105_100,
      outflow: 20_000,
      ownTransfersIn: 0,
      transactions: 8,
    });
    expect(r.accounts[0]!.categories).toMatchObject({
      creator_income: 3,
      cash_deposit: 1,
      refund: 2,
      other_inflow: 1,
      outflow: 1,
    });
  });

  it("nets equal transfers between the creator's own shared accounts within two days", () => {
    const r = analyseCashflow([
      account("main", "XXXX1111", [
        txn("2026-05-03", 10_000, "debit", "IMPS/P2A/TRANSFER", "imps"),
        txn("2026-05-07", 40_000, "credit", "ADSENSE PAYOUT"),
      ]),
      account("second", "XXXX2222", [
        txn("2026-05-04", 10_000, "credit", "IMPS INWARD P2A", "imps"),
        // Same amount but five days later: not a transfer.
        txn("2026-05-09", 10_000, "credit", "IMPS INWARD P2A", "imps"),
      ]),
    ]);
    expect(r.ownTransferPairs).toBe(1);
    const second = r.accounts.find((a) => a.key === "second")!.months[0]!;
    expect(second).toMatchObject({ inflow: 10_000, ownTransfersIn: 10_000 });
    const main = r.accounts.find((a) => a.key === "main")!.months[0]!;
    expect(main).toMatchObject({ outflow: 0, ownTransfersOut: 10_000, creatorIncome: 40_000 });
  });

  it("treats self-transfer narrations and references to another shared account as own transfers", () => {
    const r = analyseCashflow([
      account("a", "XXXXXX1111", [
        txn("2026-05-02", 7_000, "credit", "UPI/SELF TRANSFER", "upi"),
        txn("2026-05-03", 8_000, "credit", "NEFT FROM XX2222 COLLAB FEES"),
      ]),
      account("b", "XXXXXX2222", []),
    ]);
    expect(r.accounts[0]!.months[0]).toMatchObject({ inflow: 0, creatorIncome: 0, ownTransfersIn: 15_000 });
  });

  it("matches each transfer once, deterministically, regardless of input order", () => {
    const a = account("a", "XXXX1111", [txn("2026-05-03", 5_000, "debit", "TRF")]);
    const b = account("b", "XXXX2222", [
      txn("2026-05-03", 5_000, "credit", "TRF IN"),
      txn("2026-05-04", 5_000, "credit", "TRF IN"),
    ]);
    const r1 = analyseCashflow([a, b]);
    const r2 = analyseCashflow([b, a]);
    expect(r1.ownTransferPairs).toBe(1);
    expect(r2.accounts.find((x) => x.key === "b")).toEqual(r1.accounts.find((x) => x.key === "b"));
    expect(r1.accounts.find((x) => x.key === "b")!.months[0]).toMatchObject({ ownTransfersIn: 5_000, inflow: 5_000 });
  });

  it("never pairs away a credit that looks like creator income", () => {
    const r = analyseCashflow([
      account("a", "XXXX1111", [txn("2026-05-15", 25_000, "debit", "NEFT-EDITOR FEES")]),
      account("b", "XXXX2222", [txn("2026-05-15", 25_000, "credit", "NEFT-BRAND CAMPAIGN-KITE")]),
    ]);
    expect(r.ownTransferPairs).toBe(0);
    expect(r.accounts.find((x) => x.key === "b")!.months[0]).toMatchObject({ creatorIncome: 25_000 });
  });

  it("combines per-account months into the check's totals", () => {
    const totals = combineAccountMonths([
      [
        {
          month: "2026-04",
          inflow: 10,
          outflow: 5,
          creatorIncome: 8,
          ownTransfersIn: 0,
          ownTransfersOut: 3,
          transactions: 3,
        },
        {
          month: "2026-05",
          inflow: 20,
          outflow: 5,
          creatorIncome: 15,
          ownTransfersIn: 0,
          ownTransfersOut: 0,
          transactions: 2,
        },
      ],
      [
        {
          month: "2026-05",
          inflow: 7,
          outflow: 1,
          creatorIncome: 0,
          ownTransfersIn: 3,
          ownTransfersOut: 0,
          transactions: 2,
        },
      ],
    ]);
    expect(totals).toEqual([
      { month: "2026-04", inflow: 10, outflow: 5, creatorIncome: 8, ownTransfersExcluded: 0, accountsContributing: 1 },
      { month: "2026-05", inflow: 27, outflow: 6, creatorIncome: 15, ownTransfersExcluded: 3, accountsContributing: 2 },
    ]);
  });
});

describe("AA line-item guardrails", () => {
  it("seals narration with AES-256-GCM bound to the check", () => {
    const sealed = sealFiText("NEFT-BRAND COLLAB-KITE", "app-1");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("KITE");
    expect(sealFiText("NEFT-BRAND COLLAB-KITE", "app-1")).not.toBe(sealed); // random IV
    expect(openFiText(sealed, "app-1")).toBe("NEFT-BRAND COLLAB-KITE");
    expect(() => openFiText(sealed, "app-2")).toThrow();
  });

  it("stores live line items only behind the retention switch", () => {
    expect(mayRetainLineItems("mock", {})).toBe(true);
    expect(mayRetainLineItems("sandbox", {})).toBe(true);
    expect(mayRetainLineItems("live", {})).toBe(false);
    expect(mayRetainLineItems("live", { FI_LIVE_LINE_ITEM_RETENTION: "false" })).toBe(false);
    expect(mayRetainLineItems("live", { FI_LIVE_LINE_ITEM_RETENTION: "true" })).toBe(true);
  });

  it("keeps no provider transaction id, only a hash", () => {
    expect(txnRefHash("acc", "TXN-123")).toMatch(/^[0-9a-f]{64}$/);
    expect(txnRefHash("acc", "TXN-123")).not.toBe(txnRefHash("acc2", "TXN-123"));
  });
});

describe("provider output normalisation", () => {
  const base = {
    accountRef: "r",
    maskedNumber: "xxxx 1234",
    institution: " Demo Bank ",
    accountType: "savings" as const,
    discoveredViaLast4: "1234",
    status: "delivered" as const,
    periodFrom: null,
    periodTo: null,
    transactions: [],
    analytics: null,
  };
  it("normalises masks and drops unreadable accounts and line items", () => {
    const { accounts, rejected } = normaliseAccounts(
      [
        base,
        { ...base, institution: "" },
        { ...base, maskedNumber: "----" },
        { ...base, status: "delivered", transactions: null },
        {
          ...base,
          transactions: [
            {
              txnRef: "1",
              bookedOn: "2026-05-01",
              amount: 10,
              direction: "credit",
              mode: "weird" as never,
              narration: "x",
              counterparty: null,
            },
            {
              txnRef: "2",
              bookedOn: "May 1",
              amount: 10,
              direction: "credit",
              mode: "upi",
              narration: "x",
              counterparty: null,
            },
            {
              txnRef: "3",
              bookedOn: "2026-05-01",
              amount: 0.001,
              direction: "debit",
              mode: "upi",
              narration: "x",
              counterparty: null,
            },
          ],
        },
      ],
      "9999",
    );
    expect(rejected).toBe(2);
    expect(accounts[0]).toMatchObject({ maskedNumber: "XXXX1234", institution: "Demo Bank" });
    expect(accounts[1]!.status).toBe("failed"); // "delivered" without data
    expect(accounts[2]!.transactions).toEqual([expect.objectContaining({ txnRef: "1", mode: "other" })]);
  });
});
