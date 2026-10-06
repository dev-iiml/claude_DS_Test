/**
 * Cashflow analysis (Stage 09b) — pure and deterministic (no Node/DOM APIs).
 * Turns the line items of every account a creator shared into per-account
 * monthly totals, separating:
 *
 * - **transfers between the creator's own accounts** — never income. Netted
 *   when a debit in one shared account matches a credit of the same amount in
 *   another within OWN_TRANSFER_WINDOW_DAYS (unless the credit looks like
 *   creator income), or when the narration marks it as a self transfer;
 * - **creator income** — only credits that positively look like platform
 *   payouts, brand/agency payments or affiliate commissions;
 * - refunds/reversals and cash deposits — money in, but not creator income
 *   (user decision: income basis is AA-verified creator income only; cash and
 *   gifts aren't counted).
 *
 * The keyword lists are a PRODUCT HYPOTHESIS to tune on real (consented)
 * statements; bump CASHFLOW_ANALYSIS_VERSION whenever a rule changes.
 */
export const CASHFLOW_ANALYSIS_VERSION = "cfa-0.1.0";
export const OWN_TRANSFER_WINDOW_DAYS = 2;

export type TxnCategory = "creator_income" | "own_transfer" | "refund" | "cash_deposit" | "other_inflow" | "outflow";

export interface AnalysisTxn {
  ref: string;
  bookedOn: string; // YYYY-MM-DD
  amount: number; // INR, positive
  direction: "credit" | "debit";
  mode: string;
  narration: string;
  counterparty: string | null;
}

export interface AnalysisAccount {
  key: string;
  maskedNumber: string;
  transactions: AnalysisTxn[];
}

export interface AccountMonth {
  month: string; // YYYY-MM
  /** Money in, excluding transfers from the creator's own accounts. */
  inflow: number;
  /** Money out, excluding transfers to the creator's own accounts. */
  outflow: number;
  creatorIncome: number;
  ownTransfersIn: number;
  ownTransfersOut: number;
  transactions: number;
}

export interface AccountAnalysis {
  key: string;
  months: AccountMonth[];
  categories: Record<TxnCategory, number>;
}

export interface CashflowAnalysis {
  version: string;
  accounts: AccountAnalysis[];
  /** Debit/credit pairs matched across shared accounts. */
  ownTransferPairs: number;
}

const SELF_MARKER = /\b(self|own\s*a\/?c|own\s+account|to\s+self|from\s+self)\b/i;
const REFUND = /\b(refund|reversal|reversed|rev|chargeback|cashback)\b/i;
const CASH = /\b(cash\s*dep(osit)?|cdm|by\s+cash)\b/i;
const CREATOR_INCOME = [
  /\b(adsense|youtube|google\s+asia|meta\s+platforms|facebook|instagram|snap|sharechat|moj|josh|spotify|patreon|twitch|substack)\b/i,
  /\b(brand|collab|collaboration|campaign|sponsor|sponsorship|influencer|agency|ugc)\b/i,
  /\b(affiliate|commission|wishlink|cuelinks|earnkaro)\b/i,
];

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const paise = (n: number) => Math.round(n * 100);
const textOf = (t: AnalysisTxn) => `${t.narration} ${t.counterparty ?? ""}`;

/** True when the narration names another shared account by its masked digits (e.g. "XX4821"). */
function namesOwnAccount(t: AnalysisTxn, ownAccount: string, accounts: AnalysisAccount[]) {
  const text = textOf(t);
  return accounts.some((a) => {
    if (a.key === ownAccount) return false;
    const last4 = a.maskedNumber.slice(-4);
    return /^\d{4}$/.test(last4) && new RegExp(`(X{2,}|\\*{2,})${last4}\\b`, "i").test(text);
  });
}

function classifyCredit(t: AnalysisTxn): TxnCategory {
  const text = textOf(t);
  if (REFUND.test(text)) return "refund";
  if (t.mode === "cash" || CASH.test(text)) return "cash_deposit";
  if (CREATOR_INCOME.some((re) => re.test(text))) return "creator_income";
  return "other_inflow";
}

type Ref = { account: string; txn: AnalysisTxn };
const order = (a: Ref, b: Ref) =>
  a.txn.bookedOn.localeCompare(b.txn.bookedOn) ||
  a.account.localeCompare(b.account) ||
  a.txn.ref.localeCompare(b.txn.ref);

export function analyseCashflow(accounts: AnalysisAccount[]): CashflowAnalysis {
  const own = new Set<string>(); // `${account}\u0000${ref}`
  const id = (r: Ref) => `${r.account}\u0000${r.txn.ref}`;
  const all: Ref[] = accounts.flatMap((a) => a.transactions.map((txn) => ({ account: a.key, txn })));

  // 1. Narration says it's a self transfer, or names another shared account.
  for (const r of all) {
    if (SELF_MARKER.test(textOf(r.txn)) || namesOwnAccount(r.txn, r.account, accounts)) own.add(id(r));
  }

  // 2. Equal amount out of one shared account and into another within the window (one-to-one, earliest first).
  let pairs = 0;
  const debits = all.filter((r) => r.txn.direction === "debit" && !own.has(id(r))).sort(order);
  // A credit that positively looks like creator income is never paired away as a transfer.
  const credits = all
    .filter((r) => r.txn.direction === "credit" && !own.has(id(r)) && classifyCredit(r.txn) !== "creator_income")
    .sort(order);
  const used = new Set<string>();
  for (const c of credits) {
    const match = debits.find(
      (d) =>
        !used.has(id(d)) &&
        d.account !== c.account &&
        paise(d.txn.amount) === paise(c.txn.amount) &&
        Math.abs(dayNumber(d.txn.bookedOn) - dayNumber(c.txn.bookedOn)) <= OWN_TRANSFER_WINDOW_DAYS,
    );
    if (match) {
      used.add(id(match));
      own.add(id(match));
      own.add(id(c));
      pairs += 1;
    }
  }

  const result: AccountAnalysis[] = accounts.map((a) => {
    const months = new Map<string, AccountMonth>();
    const categories: Record<TxnCategory, number> = {
      creator_income: 0,
      own_transfer: 0,
      refund: 0,
      cash_deposit: 0,
      other_inflow: 0,
      outflow: 0,
    };
    for (const txn of a.transactions) {
      const key = txn.bookedOn.slice(0, 7);
      const m =
        months.get(key) ??
        months
          .set(key, {
            month: key,
            inflow: 0,
            outflow: 0,
            creatorIncome: 0,
            ownTransfersIn: 0,
            ownTransfersOut: 0,
            transactions: 0,
          })
          .get(key)!;
      m.transactions += 1;
      const amount = Math.round(txn.amount);
      const isOwn = own.has(id({ account: a.key, txn }));
      const category: TxnCategory = isOwn
        ? "own_transfer"
        : txn.direction === "debit"
          ? "outflow"
          : classifyCredit(txn);
      categories[category] += 1;
      if (isOwn) {
        if (txn.direction === "credit") m.ownTransfersIn += amount;
        else m.ownTransfersOut += amount;
      } else if (txn.direction === "debit") {
        m.outflow += amount;
      } else {
        m.inflow += amount;
        if (category === "creator_income") m.creatorIncome += amount;
      }
    }
    return { key: a.key, months: [...months.values()].sort((x, y) => x.month.localeCompare(y.month)), categories };
  });

  return { version: CASHFLOW_ANALYSIS_VERSION, accounts: result, ownTransferPairs: pairs };
}

export interface MonthlyTotal {
  month: string;
  inflow: number;
  outflow: number;
  creatorIncome: number;
  ownTransfersExcluded: number;
  accountsContributing: number;
}

/** Sums per-account months into the check's monthly totals. */
export function combineAccountMonths(perAccount: AccountMonth[][]): MonthlyTotal[] {
  const totals = new Map<string, MonthlyTotal>();
  for (const months of perAccount) {
    for (const m of months) {
      const t =
        totals.get(m.month) ??
        totals
          .set(m.month, {
            month: m.month,
            inflow: 0,
            outflow: 0,
            creatorIncome: 0,
            ownTransfersExcluded: 0,
            accountsContributing: 0,
          })
          .get(m.month)!;
      t.inflow += m.inflow;
      t.outflow += m.outflow;
      t.creatorIncome += m.creatorIncome;
      t.ownTransfersExcluded += m.ownTransfersIn;
      t.accountsContributing += 1;
    }
  }
  return [...totals.values()].sort((a, b) => a.month.localeCompare(b.month));
}
