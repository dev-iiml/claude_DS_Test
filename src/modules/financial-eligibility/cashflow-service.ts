import { createHash } from "node:crypto";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  cashflowAccountMonths,
  cashflowAccounts,
  cashflowMonths,
  cashflowSessions,
  creditApplications,
  fiTransactions,
  fiVendorAnalytics,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { callProvider } from "@/modules/audit";
import { sha256Hex } from "@/modules/identity/auth/tokens";
import type {
  FiTransaction,
  FinancialDataCapabilities,
  FinancialDataProvider,
  FinancialDataResult,
  SharedAccount,
} from "@/providers/financial-data/types";

import {
  analyseCashflow,
  combineAccountMonths,
  CASHFLOW_ANALYSIS_VERSION,
  type AccountMonth,
  type AnalysisAccount,
} from "./cashflow-analysis";
import {
  BANK_ACCOUNT_TYPES,
  CASHFLOW_MONTHS,
  CASHFLOW_SESSION_STALE_MS,
  FI_DATA_LIFE_DAYS,
  MAX_CASHFLOW_SESSIONS,
  MAX_MOBILE_NUMBERS,
  type CashflowCoverage,
  type CashflowSessionStatus,
  type CashflowStatus,
  SHARED_ACCOUNT_STATUSES,
} from "./domain";
import { mayRetainLineItems, openFiText, sealFiText, txnRefHash } from "./fi-data-protection";
import { mobileFingerprint } from "./pan-fingerprint";
import { aaMobileSchema, type BankCoverageInput } from "./schemas";
import {
  FinancialEligibilityError,
  audit,
  completedProfile,
  isOpen,
  ownOpenApplication,
  reopenIfConfirmed,
  requireConsent,
  type Application,
  type FinDeps,
} from "./service-support";

/**
 * Bank data via the Account Aggregator (Stage 09b). A check can hold several
 * sharing sessions — one per mobile number searched, plus retries — and
 * several accounts per session. Data from every delivered account is
 * analysed together (own-account transfers netted, creator income
 * classified) into the check's monthly totals.
 *
 * Discovery failure is never read as zero income: a check with no data
 * received is `unavailable`, and the creator chooses to try another number
 * or continue without bank data.
 */

export interface CashflowDeps extends FinDeps {
  financialData: FinancialDataProvider;
  /** The provider for a config key: completes sharing begun by a provider that is no longer primary. */
  financialDataFor?: (key: string) => Promise<FinancialDataProvider | null>;
  env?: Record<string, string | undefined>;
}

const CONSERVATIVE_CAPABILITIES: FinancialDataCapabilities = {
  multiAccountSelection: false,
  additionalNumberInJourney: false,
  returnsTransactions: false,
  maxMobileNumbers: 1,
};

/** What the routed aggregator supports (conservative defaults if it can't say). */
export function capabilitiesOf(provider: FinancialDataProvider): FinancialDataCapabilities {
  try {
    const c = provider.capabilities();
    return c && typeof c === "object" && typeof c.maxMobileNumbers === "number" ? c : CONSERVATIVE_CAPABILITIES;
  } catch {
    return CONSERVATIVE_CAPABILITIES;
  }
}

export function maxNumbersFor(provider: FinancialDataProvider) {
  return Math.max(1, Math.min(MAX_MOBILE_NUMBERS, capabilitiesOf(provider).maxMobileNumbers));
}

type Session = typeof cashflowSessions.$inferSelect;
/** A number can be gone through again: to fetch missing accounts, or to choose accounts left out last time. */
const RETRYABLE: readonly CashflowSessionStatus[] = ["completed", "partial", "failed", "declined", "abandoned"];

function isStale(s: Session, now: Date) {
  return s.status === "pending" && now.getTime() - s.createdAt.getTime() > CASHFLOW_SESSION_STALE_MS;
}

async function sessionsOf(db: DbExecutor, applicationId: string) {
  return db
    .select()
    .from(cashflowSessions)
    .where(eq(cashflowSessions.applicationId, applicationId))
    .orderBy(asc(cashflowSessions.createdAt));
}

/**
 * Starts an AA journey for a mobile number, or retries an earlier session
 * (same number — the raw number is never stored, so the adapter reuses the
 * earlier consent/handle). Returns where to send the creator.
 */
export async function startCashflowSharing(
  deps: CashflowDeps,
  input: { userId: string; applicationId: string; redirectUri: string } & (
    { mobile: string; retrySessionId?: never } | { retrySessionId: string; mobile?: never }
  ),
) {
  const now = deps.now ?? new Date();
  await completedProfile(deps.db, input.userId);
  await requireConsent(deps.db, input.userId, now);
  const app = await ownOpenApplication(deps.db, input.userId, input.applicationId);
  if (app.bureauStatus !== "completed")
    throw new FinancialEligibilityError("wrong_step", "Complete the credit check first.");

  const sessions = await sessionsOf(deps.db, app.id);
  if (sessions.length >= MAX_CASHFLOW_SESSIONS) {
    throw new FinancialEligibilityError(
      "number_limit",
      "You've reached the number of sharing attempts for this check. Continue with what you've shared, or start a new check later.",
    );
  }

  let fingerprint: string;
  let last4: string;
  let retryOf: Session | undefined;
  let mobile: string | undefined;
  if (input.retrySessionId) {
    retryOf = sessions.find((s) => s.id === input.retrySessionId);
    if (!retryOf || !(RETRYABLE.includes(retryOf.status) || isStale(retryOf, now))) {
      throw new FinancialEligibilityError("wrong_step", "This number can't be tried again. Add it as a new number.");
    }
    if (retryOf.provider !== deps.financialData.descriptor.key) {
      throw new FinancialEligibilityError(
        "provider_changed",
        "Bank data sharing changed on our side. Please add this number again.",
        app.id,
      );
    }
    fingerprint = retryOf.mobileFingerprint;
    last4 = retryOf.mobileLast4;
  } else {
    const parsed = aaMobileSchema.safeParse(input.mobile ?? "");
    if (!parsed.success) throw new FinancialEligibilityError("wrong_step", "Enter a 10-digit Indian mobile number.");
    mobile = parsed.data;
    fingerprint = mobileFingerprint(app.id, mobile);
    last4 = mobile.slice(-4);
    const numbers = new Set(sessions.map((s) => s.mobileFingerprint));
    if (!numbers.has(fingerprint) && numbers.size >= maxNumbersFor(deps.financialData)) {
      throw new FinancialEligibilityError(
        "number_limit",
        `You can search up to ${maxNumbersFor(deps.financialData)} mobile numbers for one check.`,
      );
    }
    if (sessions.some((s) => s.mobileFingerprint === fingerprint && s.accountsDelivered > 0)) {
      throw new FinancialEligibilityError(
        "duplicate_number",
        "You've already shared accounts from this number. Use “Share more accounts” on it instead.",
      );
    }
  }

  const { reference, redirectUrl } = await callProvider(
    deps.db,
    {
      userId: input.userId,
      provider: deps.financialData.descriptor,
      operation: "request_cashflow_consent",
      consentReceiptId: app.consentReceiptId,
    },
    () =>
      deps.financialData.requestConsent({
        // Pseudonymous subject: the aggregator never receives CreatorCo identifiers it doesn't need.
        subjectRef: sha256Hex(`cashflow:${input.userId}`).slice(0, 32),
        consentReceiptId: app.consentReceiptId,
        ...(retryOf ? { retryOf: retryOf.reference } : { mobile }),
        monthsRequested: CASHFLOW_MONTHS,
        dataLifeDays: FI_DATA_LIFE_DAYS,
        redirectUri: input.redirectUri,
        asOf: now,
      }),
    (r) => ({ outcome: "success", reference: r.reference }),
  );

  const sessionId = await deps.db.transaction(async (tx) => {
    const locked = await ownOpenApplication(tx, input.userId, app.id, true);
    await reopenIfConfirmed(tx, locked, input.userId);
    // An earlier unfinished journey for the same number is superseded.
    await tx
      .update(cashflowSessions)
      .set({ status: "abandoned" })
      .where(
        and(
          eq(cashflowSessions.applicationId, app.id),
          eq(cashflowSessions.mobileFingerprint, fingerprint),
          eq(cashflowSessions.status, "pending"),
        ),
      );
    const [session] = await tx
      .insert(cashflowSessions)
      .values({
        applicationId: app.id,
        provider: deps.financialData.descriptor.key,
        reference,
        mobileLast4: last4,
        mobileFingerprint: fingerprint,
        retryOf: retryOf?.id ?? null,
        createdAt: now,
      })
      .returning({ id: cashflowSessions.id });
    if (locked.cashflowStatus === "skipped") {
      await tx
        .update(creditApplications)
        .set({ cashflowStatus: "not_started" })
        .where(eq(creditApplications.id, app.id));
    }
    await deriveBankState(tx, app.id);
    await audit(tx, input.userId, app.id, "financial_eligibility.cashflow_requested", {
      retry: Boolean(retryOf),
      numbers: new Set([...sessions.map((s) => s.mobileFingerprint), fingerprint]).size,
    });
    return session!.id;
  });
  return { redirectUrl, sessionId };
}

/**
 * Return leg from the aggregator. Approved → fetch the selected accounts,
 * store them (line items inside guardrails), analyse every shared account
 * together. Rejected / no accounts / failed → recorded on the session.
 * Replayed or late returns don't change a settled session.
 */
export async function completeCashflowSharing(
  deps: CashflowDeps,
  input: { userId: string; params: Record<string, string> },
): Promise<Application> {
  const now = deps.now ?? new Date();
  const reference = deps.financialData.interpretReturn(input.params)?.reference ?? input.params.reference ?? null;
  if (!reference || reference.length > 200) throw new FinancialEligibilityError("not_found");
  const [row] = await deps.db
    .select({ session: cashflowSessions, app: creditApplications })
    .from(cashflowSessions)
    .innerJoin(creditApplications, eq(creditApplications.id, cashflowSessions.applicationId))
    .where(and(eq(cashflowSessions.reference, reference), eq(creditApplications.userId, input.userId)))
    .limit(1);
  if (!row || !isOpen(row.app)) throw new FinancialEligibilityError("not_found");
  const { session, app } = row;
  if (session.status !== "pending") return app;
  await requireConsent(deps.db, input.userId, now);

  // The reference belongs to the provider that issued it; if ops has switched since, finish with that one,
  // or — when it can no longer serve — ask the creator to share again.
  let provider = deps.financialData;
  if (session.provider !== provider.descriptor.key) {
    const pinned = deps.financialDataFor ? await deps.financialDataFor(session.provider) : null;
    if (pinned) provider = pinned;
  }
  if (session.provider !== provider.descriptor.key) {
    await settleSession(deps.db, input.userId, session, "failed", now);
    throw new FinancialEligibilityError(
      "provider_changed",
      "Bank data sharing was interrupted on our side. Please share it again.",
      app.id,
    );
  }

  const outcome = provider.interpretReturn(input.params).outcome;
  if (outcome !== "approved") {
    const status = outcome === "rejected" ? "declined" : outcome === "no_accounts" ? "no_accounts" : "failed";
    return settleSession(deps.db, input.userId, session, status, now);
  }

  let result: FinancialDataResult;
  try {
    result = await callProvider(
      deps.db,
      {
        userId: input.userId,
        provider: provider.descriptor,
        operation: "fetch_cashflow_data",
        consentReceiptId: app.consentReceiptId,
      },
      () => provider.fetchData({ reference, params: input.params, asOf: now }),
      (r) => ({
        outcome: r.accounts.some((a) => a.status === "delivered") ? "success" : "not_found",
        reference: r.reference,
      }),
    );
  } catch {
    await settleSession(deps.db, input.userId, session, "failed", now);
    throw new FinancialEligibilityError(
      "provider_error",
      "We couldn't fetch your bank data. Please try again.",
      app.id,
    );
  }

  const retain = mayRetainLineItems(provider.descriptor.mode, deps.env);
  const { accounts, rejected } = normaliseAccounts(result.accounts, session.mobileLast4);
  try {
    return await persistReturn(deps.db, {
      userId: input.userId,
      app,
      session,
      accounts,
      rejected,
      result,
      retain,
      provider,
      now,
    });
  } catch (error) {
    // Never leave the session pending (replays would refetch and fail again): settle it so "Try again" works.
    await settleSession(deps.db, input.userId, session, "failed", now).catch(() => undefined);
    if (error instanceof FinancialEligibilityError) throw error;
    throw new FinancialEligibilityError(
      "provider_error",
      "We couldn't process your bank data. Please try again.",
      app.id,
    );
  }
}

async function persistReturn(
  db: DbExecutor,
  input: {
    userId: string;
    app: Application;
    session: Session;
    accounts: SharedAccount[];
    rejected: number;
    result: FinancialDataResult;
    retain: boolean;
    provider: FinancialDataProvider;
    now: Date;
  },
): Promise<Application> {
  const { app, session, result, retain, provider, now } = input;
  return db.transaction(async (tx) => {
    const locked = await ownOpenApplication(tx, input.userId, app.id, true);
    const [current] = await tx.select().from(cashflowSessions).where(eq(cashflowSessions.id, session.id)).for("update");
    if (current!.status !== "pending") return locked; // a concurrent return already settled it
    await reopenIfConfirmed(tx, locked, input.userId);

    const dataLifeUntil = new Date(Math.min(result.dataLifeUntil.getTime(), locked.expiresAt.getTime()));
    const fresh = await storeAccounts(tx, {
      app: locked,
      session: current!,
      accounts: input.accounts,
      retain,
      dataLifeUntil,
      provider: provider.descriptor.key,
    });
    const selected = input.accounts.length + input.rejected;
    const delivered = input.accounts.filter((a) => a.status === "delivered").length;
    await tx
      .update(cashflowSessions)
      .set({
        status: delivered === 0 ? "failed" : delivered === selected ? "completed" : "partial",
        accountsSelected: selected,
        accountsDelivered: delivered,
        completedAt: now,
      })
      .where(eq(cashflowSessions.id, session.id));
    if (fresh.size > 0) {
      // New accounts arrived: the creator answers the coverage question again.
      await tx
        .update(creditApplications)
        .set({ accountsCompleteDeclared: null, missingAccountsReason: null })
        .where(eq(creditApplications.id, app.id));
    }
    const months = await recomputeCashflow(tx, app.id, fresh);
    const updated = await deriveBankState(tx, app.id);
    await audit(tx, input.userId, app.id, "financial_eligibility.cashflow_received", {
      accounts_selected: selected,
      accounts_delivered: delivered,
      accounts_unreadable: input.rejected,
      months,
      line_items_retained: retain,
    });
    return updated;
  });
}

async function settleSession(
  db: DbExecutor,
  userId: string,
  session: Session,
  status: CashflowSessionStatus,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const app = await ownOpenApplication(tx, userId, session.applicationId, true);
    const settled = await tx
      .update(cashflowSessions)
      .set({ status, completedAt: now })
      .where(and(eq(cashflowSessions.id, session.id), eq(cashflowSessions.status, "pending")))
      .returning({ id: cashflowSessions.id });
    if (!settled.length) return app;
    const updated = await deriveBankState(tx, app.id);
    await audit(tx, userId, app.id, `financial_eligibility.cashflow_${status}`);
    return updated;
  });
}

const ACCOUNT_TYPES = new Set<string>(BANK_ACCOUNT_TYPES);
const ACCOUNT_STATUSES = new Set<string>(SHARED_ACCOUNT_STATUSES);
const TXN_MODES = new Set(["upi", "neft", "imps", "rtgs", "cash", "card", "cheque", "other"]);

/**
 * Provider output is untrusted: normalise what can be normalised, drop
 * malformed line items, and leave out accounts that can't be identified
 * (counted, so the session shows as partial rather than failing outright).
 */
export function normaliseAccounts(accounts: SharedAccount[], fallbackLast4: string) {
  const out: SharedAccount[] = [];
  let rejected = 0;
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const masked = String(a?.maskedNumber ?? "")
      .toUpperCase()
      .replace(/[^X*0-9]/g, "");
    const institution = String(a?.institution ?? "")
      .trim()
      .slice(0, 120);
    if (!/^[X*]{0,16}[0-9]{2,6}$/.test(masked) || !institution || typeof a?.accountRef !== "string") {
      rejected += 1;
      continue;
    }
    const transactions = Array.isArray(a.transactions)
      ? a.transactions
          .filter(
            (t) =>
              t &&
              typeof t.txnRef === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(t.bookedOn) &&
              Number.isFinite(t.amount) &&
              Math.round(t.amount * 100) >= 1 &&
              (t.direction === "credit" || t.direction === "debit") &&
              typeof t.narration === "string",
          )
          .map((t) => ({
            ...t,
            mode: TXN_MODES.has(t.mode) ? t.mode : ("other" as const),
            counterparty: typeof t.counterparty === "string" ? t.counterparty : null,
          }))
      : null;
    const status = ACCOUNT_STATUSES.has(a.status) ? a.status : "failed";
    out.push({
      ...a,
      maskedNumber: masked,
      institution,
      accountType: ACCOUNT_TYPES.has(a.accountType) ? a.accountType : "other",
      discoveredViaLast4: /^\d{4}$/.test(a.discoveredViaLast4) ? a.discoveredViaLast4 : fallbackLast4,
      status: status === "delivered" && !transactions ? "failed" : status,
      periodFrom: typeof a.periodFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.periodFrom) ? a.periodFrom : null,
      periodTo: typeof a.periodTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.periodTo) ? a.periodTo : null,
      transactions,
      analytics: a.analytics && typeof a.analytics === "object" ? a.analytics : null,
    });
  }
  return { accounts: out, rejected };
}

const dedupeKeyFor = (a: SharedAccount) =>
  createHash("sha256")
    .update(`${a.institution.trim().toLowerCase()}|${a.accountType}|${a.maskedNumber.trim().toUpperCase()}`)
    .digest("hex");

/**
 * Upserts the session's accounts (one row per account per check) and stores
 * newly delivered line items when allowed. Returns the newly delivered
 * accounts' transactions (for the analysis, whether or not they're stored).
 */
async function storeAccounts(
  tx: DbExecutor,
  input: {
    app: Application;
    session: Session;
    accounts: SharedAccount[];
    retain: boolean;
    dataLifeUntil: Date;
    provider: string;
  },
): Promise<Map<string, FiTransaction[]>> {
  const fresh = new Map<string, FiTransaction[]>();
  for (const a of input.accounts) {
    const dedupeKey = dedupeKeyFor(a);
    const [existing] = await tx
      .select()
      .from(cashflowAccounts)
      .where(and(eq(cashflowAccounts.applicationId, input.app.id), eq(cashflowAccounts.dedupeKey, dedupeKey)))
      .limit(1);
    // Already delivered (e.g. the same account found through another number): keep the first copy.
    if (existing?.status === "delivered") continue;
    const delivered = a.status === "delivered" && a.transactions !== null;
    const retained = delivered && input.retain;
    const values = {
      sessionId: input.session.id,
      maskedNumber: a.maskedNumber.trim().toUpperCase(),
      institution: a.institution.trim().slice(0, 120),
      accountType: a.accountType,
      discoveredViaLast4: a.discoveredViaLast4,
      status: delivered ? ("delivered" as const) : a.status === "delivered" ? ("failed" as const) : a.status,
      periodFrom: delivered ? a.periodFrom : null,
      periodTo: delivered ? a.periodTo : null,
      transactionsRetained: retained,
      dataLifeUntil: retained ? input.dataLifeUntil : null,
    };
    const [row] = existing
      ? await tx.update(cashflowAccounts).set(values).where(eq(cashflowAccounts.id, existing.id)).returning()
      : await tx
          .insert(cashflowAccounts)
          .values({ applicationId: input.app.id, dedupeKey, ...values })
          .returning();
    if (!delivered) continue;
    fresh.set(row!.id, a.transactions!);
    if (!retained) continue;
    const rows = a.transactions!.map((t) => ({
      applicationId: input.app.id,
      accountId: row!.id,
      txnRefHash: txnRefHash(row!.id, t.txnRef),
      bookedOn: t.bookedOn,
      amount: t.amount.toFixed(2),
      direction: t.direction,
      mode: /^[a-z]{2,10}$/.test(t.mode) ? t.mode : "other",
      narrationSealed: sealFiText(t.narration.slice(0, 500), input.app.id),
      counterpartySealed: t.counterparty ? sealFiText(t.counterparty.slice(0, 200), input.app.id) : null,
      dataLifeUntil: input.dataLifeUntil,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(fiTransactions)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing();
    }
    if (a.analytics) {
      await tx
        .insert(fiVendorAnalytics)
        .values({
          applicationId: input.app.id,
          accountId: row!.id,
          provider: input.provider,
          payloadSealed: sealFiText(JSON.stringify(a.analytics).slice(0, 20_000), input.app.id),
          dataLifeUntil: input.dataLifeUntil,
        })
        .onConflictDoNothing();
    }
  }
  return fresh;
}

/**
 * Re-analyses every delivered account with line items available (just
 * fetched, or still held) — so own-account transfers between accounts from
 * different numbers are netted — and rebuilds the check's monthly totals.
 * Accounts whose line items aren't held (live data with retention off, or
 * past data-life) keep the per-account totals computed when they arrived.
 * Returns the number of months.
 */
export async function recomputeCashflow(
  tx: DbExecutor,
  applicationId: string,
  fresh: Map<string, FiTransaction[]> = new Map(),
): Promise<number> {
  const accounts = await tx
    .select()
    .from(cashflowAccounts)
    .where(and(eq(cashflowAccounts.applicationId, applicationId), eq(cashflowAccounts.status, "delivered")));

  const analysable: AnalysisAccount[] = [];
  for (const a of accounts) {
    let txns: FiTransaction[] | null = fresh.get(a.id) ?? null;
    if (!txns && a.transactionsRetained) {
      const stored = await tx.select().from(fiTransactions).where(eq(fiTransactions.accountId, a.id));
      txns = stored.map((t) => ({
        txnRef: t.txnRefHash,
        bookedOn: t.bookedOn,
        amount: Number(t.amount),
        direction: t.direction,
        mode: t.mode as FiTransaction["mode"],
        narration: openFiText(t.narrationSealed, applicationId),
        counterparty: t.counterpartySealed ? openFiText(t.counterpartySealed, applicationId) : null,
      }));
    }
    if (txns) {
      analysable.push({
        key: a.id,
        maskedNumber: a.maskedNumber,
        transactions: txns.map((t) => ({
          ref: t.txnRef,
          bookedOn: t.bookedOn,
          amount: t.amount,
          direction: t.direction,
          mode: t.mode,
          narration: t.narration,
          counterparty: t.counterparty,
        })),
      });
    }
  }

  const analysis = analyseCashflow(analysable);
  const analysedIds = analysis.accounts.map((a) => a.key);
  if (analysedIds.length) {
    await tx.delete(cashflowAccountMonths).where(inArray(cashflowAccountMonths.accountId, analysedIds));
    const rows = analysis.accounts.flatMap((a) =>
      a.months.map((m) => ({
        accountId: a.key,
        applicationId,
        month: `${m.month}-01`,
        analysisVersion: CASHFLOW_ANALYSIS_VERSION,
        inflowTotal: m.inflow,
        outflowTotal: m.outflow,
        creatorIncome: m.creatorIncome,
        ownTransfersIn: m.ownTransfersIn,
        ownTransfersOut: m.ownTransfersOut,
        transactionCount: m.transactions,
      })),
    );
    if (rows.length) await tx.insert(cashflowAccountMonths).values(rows);
  }

  const stored = await tx
    .select()
    .from(cashflowAccountMonths)
    .where(eq(cashflowAccountMonths.applicationId, applicationId));
  const deliveredIds = new Set(accounts.map((a) => a.id));
  const perAccount = new Map<string, AccountMonth[]>();
  for (const m of stored) {
    if (!deliveredIds.has(m.accountId)) continue;
    const list = perAccount.get(m.accountId) ?? perAccount.set(m.accountId, []).get(m.accountId)!;
    list.push({
      month: m.month.slice(0, 7),
      inflow: m.inflowTotal,
      outflow: m.outflowTotal,
      creatorIncome: m.creatorIncome,
      ownTransfersIn: m.ownTransfersIn,
      ownTransfersOut: m.ownTransfersOut,
      transactions: m.transactionCount,
    });
  }
  const totals = combineAccountMonths([...perAccount.values()]).slice(-CASHFLOW_MONTHS);

  await tx.delete(cashflowMonths).where(eq(cashflowMonths.applicationId, applicationId));
  if (totals.length) {
    await tx.insert(cashflowMonths).values(
      totals.map((t) => ({
        applicationId,
        month: `${t.month}-01`,
        inflowTotal: t.inflow,
        outflowTotal: t.outflow,
        creatorIncomeInflow: t.creatorIncome,
        ownTransfersExcluded: t.ownTransfersExcluded,
        accountsContributing: t.accountsContributing,
      })),
    );
  }
  return totals.length;
}

/** Derives the bank step's status and coverage from sessions, accounts and the creator's answer. */
async function deriveBankState(tx: DbExecutor, applicationId: string): Promise<Application> {
  const [app] = await tx.select().from(creditApplications).where(eq(creditApplications.id, applicationId));
  const sessions = await sessionsOf(tx, applicationId);
  const accounts = await tx
    .select({ status: cashflowAccounts.status })
    .from(cashflowAccounts)
    .where(eq(cashflowAccounts.applicationId, applicationId));
  const delivered = accounts.filter((a) => a.status === "delivered").length;
  const notReceived = accounts.length - delivered;

  let status: CashflowStatus;
  if (delivered > 0) status = "completed";
  else if (sessions.some((s) => s.status === "pending")) status = "pending";
  else if (app!.cashflowStatus === "skipped") status = "skipped";
  else if (!sessions.length) status = "not_started";
  else status = sessions.at(-1)!.status === "declined" ? "declined" : "unavailable";

  const coverage: CashflowCoverage | null =
    delivered === 0
      ? sessions.length
        ? "none"
        : null
      : app!.accountsCompleteDeclared === true && notReceived === 0
        ? "complete"
        : "partial";

  const [updated] = await tx
    .update(creditApplications)
    .set({ cashflowStatus: status, cashflowCoverage: coverage })
    .where(eq(creditApplications.id, applicationId))
    .returning();
  return updated!;
}

/** "Have you shared every account where you receive creator income?" */
export async function saveBankCoverage(
  deps: FinDeps,
  input: { userId: string; applicationId: string; coverage: BankCoverageInput },
) {
  const now = deps.now ?? new Date();
  await requireConsent(deps.db, input.userId, now);
  return deps.db.transaction(async (tx) => {
    const app = await ownOpenApplication(tx, input.userId, input.applicationId, true);
    if (app.cashflowStatus !== "completed")
      throw new FinancialEligibilityError("wrong_step", "Share at least one bank account first.");
    await reopenIfConfirmed(tx, app, input.userId);
    await tx
      .update(creditApplications)
      .set({
        accountsCompleteDeclared: input.coverage.allShared,
        missingAccountsReason: input.coverage.allShared ? null : input.coverage.missingReason,
      })
      .where(eq(creditApplications.id, app.id));
    const updated = await deriveBankState(tx, app.id);
    await audit(tx, input.userId, app.id, "financial_eligibility.coverage_answered", {
      all_shared: input.coverage.allShared,
      ...(input.coverage.allShared ? {} : { reason: input.coverage.missingReason }),
    });
    return updated;
  });
}

/** The creator continues without bank data (no income can then be verified). */
export async function skipCashflow(deps: FinDeps, input: { userId: string; applicationId: string }) {
  const now = deps.now ?? new Date();
  await requireConsent(deps.db, input.userId, now);
  return deps.db.transaction(async (tx) => {
    const app = await ownOpenApplication(tx, input.userId, input.applicationId, true);
    if (app.bureauStatus !== "completed")
      throw new FinancialEligibilityError("wrong_step", "Complete the credit check first.");
    if (app.cashflowStatus === "completed")
      throw new FinancialEligibilityError("wrong_step", "You've already shared bank data for this check.");
    if (app.cashflowStatus === "skipped") return app;
    await reopenIfConfirmed(tx, app, input.userId);
    await tx
      .update(cashflowSessions)
      .set({ status: "abandoned" })
      .where(and(eq(cashflowSessions.applicationId, app.id), eq(cashflowSessions.status, "pending")));
    const [updated] = await tx
      .update(creditApplications)
      .set({ cashflowStatus: "skipped", cashflowCoverage: null })
      .where(eq(creditApplications.id, app.id))
      .returning();
    await audit(tx, input.userId, app.id, "financial_eligibility.cashflow_skipped");
    return updated!;
  });
}

// ---------------------------------------------------------------------------
// Read model for the bank step (no line items, no numbers beyond last four digits)
// ---------------------------------------------------------------------------

export interface BankAccountView {
  id: string;
  institution: string;
  accountType: string;
  maskedNumber: string;
  status: string;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface BankNumberView {
  /** Opaque, stable within the check (two numbers can share their last four digits). */
  key: string;
  last4: string;
  /** The latest session searched for this number (absent for a number added inside the AA journey). */
  session: {
    id: string;
    status: CashflowSessionStatus;
    stale: boolean;
    canRetry: boolean;
  } | null;
  accounts: BankAccountView[];
}

export interface BankOverview {
  numbers: BankNumberView[];
  accountsShared: number;
  accountsNotReceived: number;
  numbersSearched: number;
  attemptsLeft: number;
  coverage: CashflowCoverage | null;
  accountsCompleteDeclared: boolean | null;
  missingAccountsReason: string | null;
}

export async function getBankOverview(
  db: DbExecutor,
  input: { userId: string; applicationId: string; currentProvider?: string; now?: Date },
): Promise<BankOverview | null> {
  const now = input.now ?? new Date();
  const [app] = await db
    .select()
    .from(creditApplications)
    .where(and(eq(creditApplications.id, input.applicationId), eq(creditApplications.userId, input.userId)))
    .limit(1);
  if (!app) return null;
  const sessions = await sessionsOf(db, app.id);
  const accounts = await db
    .select()
    .from(cashflowAccounts)
    .where(eq(cashflowAccounts.applicationId, app.id))
    .orderBy(asc(cashflowAccounts.createdAt));

  const latestByNumber = new Map<string, Session>();
  for (const s of sessions) latestByNumber.set(s.mobileFingerprint, s); // ascending → last wins
  const sessionNumber = new Map(sessions.map((s) => [s.id, s.mobileFingerprint]));
  const numbers = new Map<string, BankNumberView>();
  for (const s of latestByNumber.values()) {
    const stale = isStale(s, now);
    numbers.set(s.mobileFingerprint, {
      key: s.id,
      last4: s.mobileLast4,
      session: {
        id: s.id,
        status: s.status,
        stale,
        canRetry:
          (RETRYABLE.includes(s.status) || stale) &&
          sessions.length < MAX_CASHFLOW_SESSIONS &&
          (!input.currentProvider || s.provider === input.currentProvider),
      },
      accounts: [],
    });
  }
  for (const a of accounts) {
    // The account belongs to the number its session searched, or — found through a number the AA verified
    // inside the journey — to that number's own group.
    const fp = sessionNumber.get(a.sessionId);
    const searched = fp !== undefined && numbers.get(fp)?.last4 === a.discoveredViaLast4 ? fp : undefined;
    const key = searched ?? `journey:${a.discoveredViaLast4}`;
    const n =
      numbers.get(key) ??
      numbers
        .set(key, { key: `journey-${a.discoveredViaLast4}`, last4: a.discoveredViaLast4, session: null, accounts: [] })
        .get(key)!;
    n.accounts.push({
      id: a.id,
      institution: a.institution,
      accountType: a.accountType,
      maskedNumber: a.maskedNumber,
      status: a.status,
      periodFrom: a.periodFrom,
      periodTo: a.periodTo,
    });
  }
  const shared = accounts.filter((a) => a.status === "delivered").length;
  return {
    numbers: [...numbers.values()],
    accountsShared: shared,
    accountsNotReceived: accounts.length - shared,
    numbersSearched: latestByNumber.size,
    attemptsLeft: Math.max(0, MAX_CASHFLOW_SESSIONS - sessions.length),
    coverage: app.cashflowCoverage,
    accountsCompleteDeclared: app.accountsCompleteDeclared,
    missingAccountsReason: app.missingAccountsReason,
  };
}

// ---------------------------------------------------------------------------
// Data-life purge (scheduled job)
// ---------------------------------------------------------------------------

/**
 * Deletes AA line items and vendor analytics whose consent data-life has
 * ended. Derived per-account and monthly totals stay with the check until it
 * is erased (closure, expiry, withdrawal).
 */
export async function purgeExpiredFiData(deps: { db: DbExecutor; now?: Date }) {
  const now = deps.now ?? new Date();
  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`set local creatorco.erasure = 'on'`);
    const txns = await tx
      .delete(fiTransactions)
      .where(sql`${fiTransactions.dataLifeUntil} <= ${now.toISOString()}::timestamptz`)
      .returning({ accountId: fiTransactions.accountId });
    const analytics = await tx
      .delete(fiVendorAnalytics)
      .where(sql`${fiVendorAnalytics.dataLifeUntil} <= ${now.toISOString()}::timestamptz`)
      .returning({ id: fiVendorAnalytics.id });
    await tx.execute(sql`set local creatorco.erasure = 'off'`);
    const accountIds = [...new Set(txns.map((t) => t.accountId))];
    if (accountIds.length) {
      await tx
        .update(cashflowAccounts)
        .set({ transactionsRetained: false })
        .where(and(inArray(cashflowAccounts.id, accountIds), ne(cashflowAccounts.transactionsRetained, false)));
    }
    return { line_items: txns.length, vendor_analytics: analytics.length, accounts: accountIds.length };
  });
}
