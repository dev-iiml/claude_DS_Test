import { ProviderError } from "../errors";
import { stableHash, type ProviderHealth } from "../types";
import type {
  AggregatorReturn,
  FiTransaction,
  FinancialDataCapabilities,
  FinancialDataProvider,
  FinancialDataResult,
  SharedAccount,
} from "./types";

/**
 * Deterministic mock Account Aggregator (Stage 09b). The journey runs on
 * CreatorCo's own `/connect/aa-mock` screen. Accounts "discovered" for a
 * mobile number depend on its last digit, so every scenario is testable:
 *
 * - ends in 0 → no accounts found
 * - ends in 5 → three accounts (savings, current, savings)
 * - ends in 9 → two accounts; the second times out on the first attempt (retry fixes it)
 * - otherwise → one or two accounts
 *
 * Transactions are synthetic: platform payouts, brand payments and affiliate
 * commissions (creator income), cash deposits, refunds, gifts and transfers
 * between the creator's own accounts — so the analysis has something real to
 * separate. The reference carries only the number's last four digits.
 */

const BANKS = ["Demo Bank", "Sample Co-operative Bank", "Example Small Finance Bank", "Test National Bank"];
const AGENCIES = ["Northlight Media LLP", "Tidal Brand Studio", "Kite Collective"];
const REFERENCE = /^aa_([a-z0-9]+)_([a-z0-9]+)_(\d{6})_(\d{1,2})_(\d{1,3})_(\d{4})_([fr])$/;
export const MOCK_ACCOUNT_REF = /^(\d{4})-(\d)$/;

interface MockAccountSpec {
  ref: string;
  last4: string;
  index: number;
  institution: string;
  maskedNumber: string;
  accountType: SharedAccount["accountType"];
}

/** Accounts the mock AA "discovers" for a mobile number (by its last four digits). */
export function mockAccountsFor(last4: string): MockAccountSpec[] {
  const d = Number(last4.at(-1));
  const h = stableHash(`acct:${last4}`);
  const n = d === 0 ? 0 : d === 5 ? 3 : d === 9 ? 2 : 1 + (h % 2);
  return Array.from({ length: n }, (_, i) => ({
    ref: `${last4}-${i}`,
    last4,
    index: i,
    institution: BANKS[(h + i * 3) % BANKS.length]!,
    maskedNumber: `XXXXXX${String((h >>> (i * 4)) % 10_000).padStart(4, "0")}`,
    accountType: d === 5 && i === 1 ? "current" : "savings",
  }));
}

const pad = (n: number) => String(n).padStart(2, "0");

function parseReference(reference: string) {
  const m = REFERENCE.exec(reference);
  if (!m) throw new ProviderError("rejected", "unknown mock reference");
  return {
    subject: m[1]!,
    anchor: m[3]!,
    months: Math.min(24, Math.max(1, Number(m[4]))),
    dataLifeDays: Math.max(1, Number(m[5])),
    last4: m[6]!,
    retry: m[7] === "r",
  };
}

/** Same amount moved between the creator's own accounts each month (debit day 3, credit day 4). */
const ownTransferAmount = (monthIndex: number) => 10_000 + (monthIndex % 3) * 2_500;

function transactionsFor(spec: MockAccountSpec, subject: string, anchor: string, months: number): FiTransaction[] {
  const h = stableHash(`${subject}:${spec.ref}`);
  const year = Number(anchor.slice(0, 4));
  const month0 = Number(anchor.slice(4)) - 1;
  const base = 40_000 + (h % 120_000);
  const out: FiTransaction[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(year, month0 - months + i, 1));
    const ym = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    const monthIndex = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const wobble = 1 + (((h >>> (i % 16)) % 41) - 20) / 100; // ±20%
    let k = 0;
    const add = (day: number, t: Omit<FiTransaction, "txnRef" | "bookedOn">) =>
      out.push({ txnRef: `${spec.ref}-${ym.replace("-", "")}-${k++}`, bookedOn: `${ym}-${pad(day)}`, ...t });

    if (spec.index === 0) {
      // The creator's main account: platform, brand and affiliate income, plus everyday spending.
      if ((h + i) % 11 !== 0) {
        add(7, {
          amount: Math.round(base * 0.4 * wobble),
          direction: "credit",
          mode: "neft",
          narration: "NEFT-GOOGLE ASIA PACIFIC PTE-ADSENSE PAYOUT",
          counterparty: "Google Asia Pacific",
        });
      }
      if ((h >>> i) % 4 !== 0) {
        add(15, {
          amount: Math.round(base * 0.45 * wobble),
          direction: "credit",
          mode: "neft",
          narration: `NEFT-BRAND COLLAB-${AGENCIES[(h + i) % AGENCIES.length]!.toUpperCase()}`,
          counterparty: AGENCIES[(h + i) % AGENCIES.length]!,
        });
      }
      add(22, {
        amount: Math.round(base * 0.08 * wobble),
        direction: "credit",
        mode: "imps",
        narration: "IMPS-AFFILIATE COMMISSION-PAYOUT",
        counterparty: null,
      });
      if (i % 4 === 0) {
        add(10, { amount: 5_000, direction: "credit", mode: "cash", narration: "CASH DEP BRANCH", counterparty: null });
      }
      if (i % 5 === 2) {
        add(18, {
          amount: 1_250,
          direction: "credit",
          mode: "upi",
          narration: "UPI/REFUND/ONLINE ORDER",
          counterparty: null,
        });
      }
      add(3, {
        amount: ownTransferAmount(monthIndex),
        direction: "debit",
        mode: "imps",
        narration: "IMPS/P2A/TRANSFER",
        counterparty: null,
      });
      add(1, {
        amount: Math.round(base * 0.22),
        direction: "debit",
        mode: "upi",
        narration: "UPI/RENT/MONTHLY",
        counterparty: null,
      });
      add(12, {
        amount: Math.round(base * 0.18 * wobble),
        direction: "debit",
        mode: "neft",
        narration: "CREDIT CARD BILL PAYMENT",
        counterparty: null,
      });
      add(20, {
        amount: Math.round(base * 0.15),
        direction: "debit",
        mode: "upi",
        narration: "UPI/GROCERIES AND TRAVEL",
        counterparty: null,
      });
    } else if (spec.accountType === "current") {
      // A current account some brands pay into.
      if (i % 3 === 0) {
        add(25, {
          amount: Math.round(base * 0.9),
          direction: "credit",
          mode: "rtgs",
          narration: `RTGS-BRAND CAMPAIGN-${AGENCIES[(h + i + 1) % AGENCIES.length]!.toUpperCase()}`,
          counterparty: AGENCIES[(h + i + 1) % AGENCIES.length]!,
        });
      }
      add(26, {
        amount: Math.round(base * 0.2),
        direction: "debit",
        mode: "neft",
        narration: "NEFT-EDITOR FEES",
        counterparty: null,
      });
    } else {
      // A secondary savings account fed from the main one.
      add(4, {
        amount: ownTransferAmount(monthIndex),
        direction: "credit",
        mode: "imps",
        narration: "IMPS INWARD P2A",
        counterparty: null,
      });
      if (i % 3 === 1) {
        add(14, { amount: 3_000, direction: "credit", mode: "upi", narration: "UPI/GIFT/FAMILY", counterparty: null });
      }
      add(16, {
        amount: Math.round(ownTransferAmount(monthIndex) * 0.7),
        direction: "debit",
        mode: "upi",
        narration: "UPI/SHOPPING",
        counterparty: null,
      });
    }
  }
  return out.sort((a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.txnRef.localeCompare(b.txnRef));
}

export class MockFinancialDataProvider implements FinancialDataProvider {
  readonly descriptor = { key: "mock", kind: "financial_data", mode: "mock" } as const;

  constructor(private readonly approvePath = "/connect/aa-mock") {}

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  capabilities(): FinancialDataCapabilities {
    return {
      multiAccountSelection: true,
      additionalNumberInJourney: true,
      returnsTransactions: true,
      maxMobileNumbers: 3,
    };
  }

  interpretReturn(params: Record<string, string>): AggregatorReturn {
    const reference = params.reference && REFERENCE.test(params.reference) ? params.reference : null;
    const outcome = (["approved", "rejected", "no_accounts"] as const).find((o) => o === params.status) ?? "failed";
    return { reference, outcome };
  }

  async requestConsent(input: Parameters<FinancialDataProvider["requestConsent"]>[0]) {
    const last4 = input.retryOf ? parseReference(input.retryOf).last4 : input.mobile?.slice(-4);
    if (!input.retryOf && !/^[6-9]\d{9}$/.test(input.mobile ?? ""))
      throw new ProviderError("rejected", "invalid mobile");
    const anchor = `${input.asOf.getUTCFullYear()}${pad(input.asOf.getUTCMonth() + 1)}`;
    const nonce = stableHash(
      `${input.consentReceiptId}:${input.asOf.toISOString()}:${input.mobile ?? input.retryOf}`,
    ).toString(36);
    const reference = [
      "aa",
      stableHash(input.subjectRef).toString(36),
      nonce,
      anchor,
      input.monthsRequested,
      input.dataLifeDays,
      last4,
      input.retryOf ? "r" : "f",
    ].join("_");
    const q = new URLSearchParams({ reference, redirect_uri: input.redirectUri });
    return { reference, redirectUrl: `${this.approvePath}?${q.toString()}` };
  }

  async fetchData(input: {
    reference: string;
    params: Record<string, string>;
    asOf: Date;
  }): Promise<FinancialDataResult> {
    const r = parseReference(input.reference);
    const selected = [...new Set((input.params.accounts ?? "").split(",").filter((a) => MOCK_ACCOUNT_REF.test(a)))];
    const accounts: SharedAccount[] = selected.flatMap((ref) => {
      const last4 = ref.slice(0, 4);
      const spec = mockAccountsFor(last4).find((a) => a.ref === ref);
      if (!spec) return [];
      const timedOut = Number(last4.at(-1)) === 9 && spec.index === 1 && !r.retry;
      const transactions = timedOut ? null : transactionsFor(spec, r.subject, r.anchor, r.months);
      return [
        {
          accountRef: spec.ref,
          maskedNumber: spec.maskedNumber,
          institution: spec.institution,
          accountType: spec.accountType,
          discoveredViaLast4: last4,
          status: timedOut ? "timeout" : "delivered",
          periodFrom: transactions?.[0]?.bookedOn ?? null,
          periodTo: transactions?.at(-1)?.bookedOn ?? null,
          transactions,
          analytics: timedOut
            ? null
            : {
                average_monthly_balance: 15_000 + (stableHash(spec.ref) % 60_000),
                bounced_payments_12m: 0,
                vendor_model: "mock-analytics-1",
              },
        },
      ];
    });
    const delivered = accounts.filter((a) => a.status === "delivered").length;
    return {
      reference: input.reference,
      status: delivered === 0 ? "failed" : delivered === accounts.length ? "completed" : "partial",
      accounts,
      retrievedAt: input.asOf,
      dataLifeUntil: new Date(input.asOf.getTime() + r.dataLifeDays * 86_400_000),
    };
  }
}
