import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditEvents,
  bureauSummaries,
  cashflowAccounts,
  cashflowMonths,
  cashflowSessions,
  creatorProfiles,
  creditApplications,
  fiTransactions,
  fiVendorAnalytics,
  financialFeatureRuns,
  financialFeatures,
  identityLookupResults,
  providerRequests,
} from "@/db/schema";
import { CONSENT_KEYS, grantConsent, hasValidConsent } from "@/modules/consent";
import { CONSENT_DEFINITION_SEEDS, currentDefinitionSeed } from "@/modules/consent/definitions";
import {
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import {
  closeApplication,
  confirmApplication,
  expireStaleApplications,
  getApplication,
  getFinancialCapacity,
  getOpenApplication,
  runBureauCheck,
  saveApplicationDetails,
  startApplication,
} from "@/modules/financial-eligibility/application-service";
import {
  completeCashflowSharing,
  getBankOverview,
  purgeExpiredFiData,
  saveBankCoverage,
  skipCashflow,
  startCashflowSharing,
} from "@/modules/financial-eligibility/cashflow-service";
import { applicationDetailsSchema } from "@/modules/financial-eligibility/schemas";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { withdrawPurpose } from "@/modules/privacy";
import { MockCreditBureauProvider } from "@/providers/bureau/mock-credit-bureau-provider";
import { MockFinancialDataProvider } from "@/providers/financial-data/mock-financial-data-provider";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";
import { shareAndConfirm, shareBank } from "../support/eligibility";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const FIN_CONSENT = currentDefinitionSeed(CONSENT_KEYS.financialEligibility)!.id;
const bureau = new MockCreditBureauProvider();
const financialData = new MockFinancialDataProvider();
const details = applicationDetailsSchema.parse({
  purposes: ["equipment", "other"],
  purposeNote: "a podcast booth",
  requestedAmount: "2,00,000",
  declaredMonthlyIncome: "90,000",
  declaredMonthlyEmi: "5,000",
  incomeSources: ["brand_deals", "platform_payouts"],
});

async function member(label = "fin") {
  const r = await signUpCreator(auth, { email: testEmail(label), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Neel Shah",
      displayName: "Neel Films",
      city: "Ahmedabad",
      state: "Gujarat",
      languages: ["gu"],
    }),
  );
  await saveProfileStep(
    db,
    userId,
    profileStepSchema.parse({
      primaryCreatorHandle: `neel.${label}.test`,
      categories: ["photography"],
      primaryCategory: "photography",
      creatorSince: "2019-03",
      platforms: ["youtube"],
    }),
  );
  await saveBusinessStep(
    db,
    userId,
    businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" }),
  );
  await saveInterestsStep(db, userId, {
    prInterest: false,
    preferredCategories: [],
    brandInterests: [],
    travelInterest: false,
  });
  await completeOnboarding(db, userId, {
    consentDefinitionId: CONSENT_DEFINITION_SEEDS.find((d) => d.key === CONSENT_KEYS.creatorProfile)!.id,
  });
  return userId;
}

/** A member with a check that has details and a bureau summary. */
async function checkedMember(label: string, pan = "ABCPE1238F") {
  const userId = await member(label);
  const app = await startApplication({ db }, { userId, consentDefinitionId: FIN_CONSENT, source: "settings" });
  await saveApplicationDetails({ db }, { userId, applicationId: app.id, details });
  await runBureauCheck({ db, bureau }, { userId, applicationId: app.id, pan });
  return { userId, applicationId: app.id };
}

const rowsOf = async (
  table: typeof cashflowAccounts | typeof fiTransactions | typeof cashflowMonths,
  applicationId: string,
) => (await db.select({ n: count() }).from(table).where(eq(table.applicationId, applicationId)))[0]!.n;

describe("regulated financial domain", () => {
  it("keeps financial tables in their own `fin` schema", async () => {
    const rows = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'fin' order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "bureau_summaries",
      "cashflow_account_months",
      "cashflow_accounts",
      "cashflow_months",
      "cashflow_sessions",
      "credit_applications",
      "credit_proposals",
      "decision_queries",
      "decision_reviews",
      "fi_transactions",
      "fi_vendor_analytics",
      "financial_feature_runs",
      "financial_features",
      "fraud_checks",
      "fraud_flags",
      "lender_decisions",
      "offer_responses",
      "underwriting_inputs",
      "underwriting_results",
      "underwriting_runs",
    ]);
  });
});

describe("starting a check", () => {
  it("needs a completed profile, records the consent and is idempotent while open", async () => {
    const draft = await signUpCreator(auth, { email: testEmail("draft"), password: "a long enough passphrase" });
    if (!draft.ok) throw new Error();
    await expect(
      startApplication({ db }, { userId: draft.user.userId, consentDefinitionId: FIN_CONSENT, source: "settings" }),
    ).rejects.toMatchObject({ code: "profile_inactive" });

    const userId = await member("start");
    const a = await startApplication({ db }, { userId, consentDefinitionId: FIN_CONSENT, source: "settings" });
    expect(a).toMatchObject({ status: "draft", bureauStatus: "not_started", cashflowStatus: "not_started" });
    expect(a.expiresAt.getTime() - a.createdAt.getTime()).toBe(90 * 86_400_000);
    expect(await hasValidConsent(db, userId, CONSENT_KEYS.financialEligibility)).toBe(true);
    const b = await startApplication({ db }, { userId, consentDefinitionId: FIN_CONSENT, source: "settings" });
    expect(b.id).toBe(a.id);
  });

  it("enforces step order", async () => {
    const userId = await member("order");
    const app = await startApplication({ db }, { userId, consentDefinitionId: FIN_CONSENT, source: "settings" });
    await expect(
      runBureauCheck({ db, bureau }, { userId, applicationId: app.id, pan: "ABCPE1238F" }),
    ).rejects.toMatchObject({
      code: "wrong_step",
    });
    await expect(
      startCashflowSharing(
        { db, financialData },
        { userId, applicationId: app.id, redirectUri: "http://x/cb", mobile: "9876543211" },
      ),
    ).rejects.toMatchObject({ code: "wrong_step" });
  });
});

describe("bureau check", () => {
  it("stores only a summary and a masked PAN — the full PAN appears nowhere", async () => {
    const { userId, applicationId } = await checkedMember("bureau");
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, applicationId));
    expect(app).toMatchObject({ panMasked: "XXXXX1238F", bureauStatus: "completed" });
    const [summary] = await db.select().from(bureauSummaries).where(eq(bureauSummaries.applicationId, applicationId));
    expect(summary).toMatchObject({ scoreBand: "high", delinquentTradelines12m: 0, enquiries6m: 2 });

    const dump = JSON.stringify([
      app,
      summary,
      await db.select().from(providerRequests).where(eq(providerRequests.userId, userId)),
      await db.select().from(auditEvents).where(eq(auditEvents.actorId, userId)),
    ]);
    expect(dump).not.toContain("ABCPE1238F");
  });

  it("must match the creator's verified PAN when there is one", async () => {
    const userId = await member("mismatch");
    const receipt = await grantConsent(db, {
      userId,
      key: CONSENT_KEYS.identityPrefill,
      consentDefinitionId: CONSENT_DEFINITION_SEEDS.find((d) => d.key === CONSENT_KEYS.identityPrefill)!.id,
      source: "onboarding",
    });
    await db.insert(identityLookupResults).values({
      userId,
      mobile: "9000000005",
      verifiedName: "Neel Shah",
      panMasked: "XXXXX4321Z",
      provider: "mock",
      consentReceiptId: receipt.id,
      fetchedAt: new Date(),
    });
    const app = await startApplication({ db }, { userId, consentDefinitionId: FIN_CONSENT, source: "settings" });
    await saveApplicationDetails({ db }, { userId, applicationId: app.id, details });
    await expect(
      runBureauCheck({ db, bureau }, { userId, applicationId: app.id, pan: "ABCPE1238F" }),
    ).rejects.toMatchObject({
      code: "pan_mismatch",
    });
    await runBureauCheck({ db, bureau }, { userId, applicationId: app.id, pan: "ABCPE4321Z" });
  });

  it("limits bureau checks to three per 30 days", async () => {
    const { userId, applicationId } = await checkedMember("limit");
    await runBureauCheck({ db, bureau }, { userId, applicationId, pan: "ABCPE1235F" });
    await runBureauCheck({ db, bureau }, { userId, applicationId, pan: "ABCPE1236F" });
    await expect(runBureauCheck({ db, bureau }, { userId, applicationId, pan: "ABCPE1237F" })).rejects.toMatchObject({
      code: "bureau_limit",
    });
  });
});

describe("details", () => {
  it("keeps up to three purposes (main one first) and the note, never auditing the note", async () => {
    const { userId, applicationId } = await checkedMember("purposes");
    const app = (await getApplication(db, { userId, applicationId }))!;
    expect(app).toMatchObject({
      purpose: "equipment",
      purposes: ["equipment", "other"],
      purposeNote: "a podcast booth",
    });
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, applicationId));
    expect(JSON.stringify(events)).not.toContain("podcast");
  });
});

describe("bank data across accounts and numbers (Stage 09b)", () => {
  it("1. several accounts on one number: all analysed together, own transfers left out", async () => {
    const { userId, applicationId } = await checkedMember("multi");
    const { app } = await shareBank(db, { userId, applicationId, mobile: "9876543215" });
    expect(app).toMatchObject({ status: "draft", cashflowStatus: "completed", cashflowCoverage: "partial" });
    expect(await rowsOf(cashflowAccounts, applicationId)).toBe(3);
    const months = await db.select().from(cashflowMonths).where(eq(cashflowMonths.applicationId, applicationId));
    expect(months).toHaveLength(12);
    expect(months.some((m) => m.ownTransfersExcluded > 0)).toBe(true);
    expect(Math.max(...months.map((m) => m.accountsContributing))).toBe(3);
    for (const m of months) expect(m.creatorIncomeInflow!).toBeLessThanOrEqual(m.inflowTotal);

    // Confirming needs the coverage answer first — and is never automatic.
    await expect(confirmApplication({ db }, { userId, applicationId })).rejects.toMatchObject({ code: "wrong_step" });
    const answered = await saveBankCoverage({ db }, { userId, applicationId, coverage: { allShared: true } });
    expect(answered).toMatchObject({ status: "draft", cashflowCoverage: "complete" });
    const ready = await confirmApplication({ db }, { userId, applicationId });
    expect(ready.status).toBe("inputs_ready");
    const capacity = (await getFinancialCapacity(db, { userId, applicationId }))!;
    expect(capacity.engineVersion).toBe("fin-0.2.0");
    expect(capacity.features).toHaveLength(18);
    const f = Object.fromEntries(capacity.features.map((x) => [x.key, x.value]));
    expect(f).toMatchObject({ bank_accounts_shared: 3, bank_accounts_not_received: 0, bank_coverage: "complete" });
    expect(f.avg_monthly_creator_income_6m).toBeGreaterThan(0);
    expect(f.declared_to_observed_income).not.toBeNull();
  });

  it("2. no accounts on number 1, accounts on number 2 — no accounts is never zero income", async () => {
    const { userId, applicationId } = await checkedMember("nofirst");
    const first = await shareBank(db, { userId, applicationId, mobile: "9876543210", outcome: "no_accounts" });
    expect(first.app).toMatchObject({ cashflowStatus: "unavailable", cashflowCoverage: "none" });
    expect(await rowsOf(cashflowMonths, applicationId)).toBe(0); // nothing recorded as ₹0 income
    await expect(confirmApplication({ db }, { userId, applicationId })).rejects.toMatchObject({ code: "wrong_step" });

    const second = await shareBank(db, { userId, applicationId, mobile: "9123456781" });
    expect(second.app.cashflowStatus).toBe("completed");
    const overview = (await getBankOverview(db, { userId, applicationId }))!;
    expect(overview.numbers.map((n) => [n.last4, n.session?.status, n.accounts.length > 0])).toEqual([
      ["3210", "no_accounts", false],
      ["6781", "completed", true],
    ]);
    // The same number can't be searched again once it delivered; only retried.
    await expect(
      startCashflowSharing(
        { db, financialData },
        { userId, applicationId, redirectUri: "http://x/cb", mobile: "+91 91234 56781" },
      ),
    ).rejects.toMatchObject({ code: "duplicate_number" });
  });

  it("3. accounts split across two numbers — separate journeys or inside one AA journey", async () => {
    const { userId, applicationId } = await checkedMember("split");
    await shareBank(db, { userId, applicationId, mobile: "9876543215" });
    await shareBank(db, { userId, applicationId, mobile: "9988776652" });
    const overview = (await getBankOverview(db, { userId, applicationId }))!;
    expect(overview.numbers.map((n) => n.last4)).toEqual(["3215", "6652"]);
    expect(overview.accountsShared).toBe(3 + overview.numbers[1]!.accounts.length);

    // In-journey additional number (AA verifies it by OTP): one session, accounts from both numbers.
    const other = await checkedMember("injourney");
    await shareBank(db, { ...other, mobile: "9876543211", inJourney: ["4445"] });
    const view = (await getBankOverview(db, other))!;
    expect(view.numbers.map((n) => [n.last4, Boolean(n.session)])).toEqual([
      ["3211", true],
      ["4445", false],
    ]);
    expect(view.numbers[1]!.accounts).toHaveLength(3);
  });

  it("keeps an account found through two numbers once", async () => {
    const { userId, applicationId } = await checkedMember("dedupe");
    await shareBank(db, { userId, applicationId, mobile: "9876543215" });
    await shareBank(db, { userId, applicationId, mobile: "9876543217", inJourney: ["3215"] });
    const unique =
      3 +
      (await getBankOverview(db, { userId, applicationId }))!.numbers.find((n) => n.last4 === "3217")!.accounts.length;
    expect(await rowsOf(cashflowAccounts, applicationId)).toBe(unique);
  });

  it("retries accounts that didn't arrive, and asks the coverage question again", async () => {
    const { userId, applicationId } = await checkedMember("retry");
    const first = await shareBank(db, { userId, applicationId, mobile: "9876543219" });
    expect(first.app.cashflowStatus).toBe("completed");
    let overview = (await getBankOverview(db, { userId, applicationId }))!;
    expect(overview.numbers[0]!.session).toMatchObject({ status: "partial", canRetry: true });
    expect(overview.numbers[0]!.accounts.map((a) => a.status)).toEqual(["delivered", "timeout"]);
    // Even "all shared" is partial coverage while an account is missing.
    const answered = await saveBankCoverage({ db }, { userId, applicationId, coverage: { allShared: true } });
    expect(answered.cashflowCoverage).toBe("partial");

    const retried = await shareBank(db, { userId, applicationId, retrySessionId: first.sessionId });
    expect(retried.app).toMatchObject({ accountsCompleteDeclared: null }); // new data → ask again
    overview = (await getBankOverview(db, { userId, applicationId }))!;
    expect(overview.numbers[0]!.accounts.map((a) => a.status)).toEqual(["delivered", "delivered"]);
    expect(await rowsOf(cashflowAccounts, applicationId)).toBe(2);
    expect(
      (await saveBankCoverage({ db }, { userId, applicationId, coverage: { allShared: true } })).cashflowCoverage,
    ).toBe("complete");
  });

  it("partial coverage keeps verified income but drops the declared-vs-observed comparison", async () => {
    const { userId, applicationId } = await checkedMember("partialcov");
    await shareAndConfirm(db, { userId, applicationId, allShared: false });
    const app = (await getApplication(db, { userId, applicationId }))!;
    expect(app).toMatchObject({ cashflowCoverage: "partial", missingAccountsReason: "bank_not_on_aa" });
    const f = Object.fromEntries(
      (await getFinancialCapacity(db, { userId, applicationId }))!.features.map((x) => [x.key, x.value]),
    );
    expect(f.declared_to_observed_income).toBeNull();
    expect(f.emi_to_income).not.toBeNull();
    expect(f.bank_coverage).toBe("partial");
  });

  it("a declined share waits for retry or skip; skipping means no verified income", async () => {
    const { userId, applicationId } = await checkedMember("decline");
    const declined = await shareBank(db, { userId, applicationId, outcome: "rejected" });
    expect(declined.app).toMatchObject({ status: "draft", cashflowStatus: "declined" });
    const skipped = await skipCashflow({ db }, { userId, applicationId });
    expect(skipped).toMatchObject({ status: "draft", cashflowStatus: "skipped" });
    await confirmApplication({ db }, { userId, applicationId });
    const capacity = await getFinancialCapacity(db, { userId, applicationId });
    const f = Object.fromEntries(capacity!.features.map((x) => [x.key, x.value]));
    expect(f).toMatchObject({ avg_monthly_inflow_6m: null, emi_to_income: null, bank_coverage: "none" });

    // Skipping isn't offered once data has arrived.
    const other = await checkedMember("noskip");
    await shareBank(db, other);
    await expect(skipCashflow({ db }, other)).rejects.toMatchObject({ code: "wrong_step" });
  });

  it("stores line items only inside guardrails: encrypted, mock now, live behind the switch", async () => {
    const { userId, applicationId } = await checkedMember("guardrails");
    await shareBank(db, { userId, applicationId, mobile: "9876543215" });
    const [line] = await db
      .select()
      .from(fiTransactions)
      .where(eq(fiTransactions.applicationId, applicationId))
      .limit(1);
    expect(line!.narrationSealed).toMatch(/^v1\./);
    const everything = JSON.stringify([
      await db.select().from(fiTransactions).where(eq(fiTransactions.applicationId, applicationId)),
      await db.select().from(fiVendorAnalytics).where(eq(fiVendorAnalytics.applicationId, applicationId)),
      await db.select().from(cashflowSessions).where(eq(cashflowSessions.applicationId, applicationId)),
      await db.select().from(creditApplications).where(eq(creditApplications.id, applicationId)),
      await db.select().from(providerRequests).where(eq(providerRequests.userId, userId)),
      await db.select().from(auditEvents).where(eq(auditEvents.entityId, applicationId)),
    ]);
    expect(everything).not.toMatch(/ADSENSE|BRAND COLLAB|98765/);
    expect(await rowsOf(fiTransactions, applicationId)).toBeGreaterThan(30);

    // A live aggregator with the retention switch off: analysed in memory, only totals kept.
    const live = new Proxy(financialData, {
      get: (t, p, r) => (p === "descriptor" ? { ...t.descriptor, mode: "live" } : Reflect.get(t, p, r)),
    });
    const other = await checkedMember("liveoff");
    await shareBank(db, { ...other, financialData: live, env: {} });
    expect(await rowsOf(fiTransactions, other.applicationId)).toBe(0);
    expect(await rowsOf(cashflowMonths, other.applicationId)).toBe(12);
    const accounts = await db
      .select()
      .from(cashflowAccounts)
      .where(eq(cashflowAccounts.applicationId, other.applicationId));
    expect(accounts.every((a) => !a.transactionsRetained)).toBe(true);
  });

  it("purges line items when the consent's data-life ends, keeping derived totals", async () => {
    const { userId, applicationId } = await checkedMember("purge");
    await shareBank(db, { userId, applicationId });
    const [acc] = await db.select().from(cashflowAccounts).where(eq(cashflowAccounts.applicationId, applicationId));
    await expect(db.delete(fiTransactions).where(eq(fiTransactions.applicationId, applicationId))).rejects.toThrow(); // append-only outside an erasure
    const result = await purgeExpiredFiData({ db, now: new Date(acc!.dataLifeUntil!.getTime() + 1_000) });
    expect(result.line_items).toBeGreaterThan(0);
    expect(await rowsOf(fiTransactions, applicationId)).toBe(0);
    expect(await rowsOf(cashflowMonths, applicationId)).toBe(12);
    const [after] = await db.select().from(cashflowAccounts).where(eq(cashflowAccounts.id, acc!.id));
    expect(after!.transactionsRetained).toBe(false);
  });

  it("confirming is explicit; a change afterwards goes back to Review and recomputes on confirm", async () => {
    const { userId, applicationId } = await checkedMember("reopen");
    const ready = await shareAndConfirm(db, { userId, applicationId });
    expect(ready).toMatchObject({ status: "inputs_ready" });
    const edited = await saveApplicationDetails(
      { db },
      { userId, applicationId, details: { ...details, declaredMonthlyEmi: 9_000 } },
    );
    expect(edited).toMatchObject({ status: "draft", inputsReadyAt: null });
    // Nothing recomputes until the creator confirms again.
    const runs = async () =>
      (
        await db
          .select({ n: count() })
          .from(financialFeatureRuns)
          .where(eq(financialFeatureRuns.applicationId, applicationId))
      )[0]!.n;
    expect(await runs()).toBe(1);
    await confirmApplication({ db }, { userId, applicationId });
    expect(await runs()).toBe(2);
    // Confirming again with the same inputs reuses the run.
    await confirmApplication({ db }, { userId, applicationId });
    expect(await runs()).toBe(2);
    // Adding a number after confirming also reopens the check.
    await shareBank(db, { userId, applicationId, mobile: "9876543215" });
    expect((await getApplication(db, { userId, applicationId }))!.status).toBe("draft");
    // Runs are append-only.
    await expect(
      db
        .update(financialFeatureRuns)
        .set({ engineVersion: "x" })
        .where(eq(financialFeatureRuns.applicationId, applicationId)),
    ).rejects.toThrow();
  });

  it("underwriting reads the run the creator confirmed, even after a change and change back", async () => {
    const { userId, applicationId } = await checkedMember("pinned");
    await shareAndConfirm(db, { userId, applicationId });
    const coverage = async (allShared: boolean) => {
      await saveBankCoverage(
        { db },
        {
          userId,
          applicationId,
          coverage: allShared ? { allShared: true } : { allShared: false, missingReason: "chose_not_to_share" },
        },
      );
      return confirmApplication({ db }, { userId, applicationId });
    };
    const value = async () =>
      (await getFinancialCapacity(db, { userId, applicationId }))!.features.find((f) => f.key === "bank_coverage")!
        .value;
    await coverage(false);
    expect(await value()).toBe("partial");
    const back = await coverage(true); // identical to the first confirmation: its run is reused…
    expect(await value()).toBe("complete"); // …and pinned, not the later "partial" run
    expect(back.financialRunId).not.toBeNull();
  });

  it("a completed number can be gone through again to share accounts left out", async () => {
    const { userId, applicationId } = await checkedMember("more");
    const first = await shareBank(db, { userId, applicationId, mobile: "9876543215", accounts: ["3215-0"] });
    let view = (await getBankOverview(db, { userId, applicationId }))!;
    expect(view.numbers[0]!.session).toMatchObject({ status: "completed", canRetry: true });
    await shareBank(db, { userId, applicationId, retrySessionId: first.sessionId });
    view = (await getBankOverview(db, { userId, applicationId }))!;
    expect(view.accountsShared).toBe(3);
    expect(view.numbers).toHaveLength(1);
  });

  it("malformed provider data never breaks the return or leaves the session pending", async () => {
    const { userId, applicationId } = await checkedMember("malformed");
    const broken = new Proxy(financialData, {
      get: (t, p, r) =>
        p === "fetchData"
          ? async (i: Parameters<typeof financialData.fetchData>[0]) => {
              const real = await t.fetchData(i);
              return {
                ...real,
                accounts: [
                  { ...real.accounts[0]!, maskedNumber: "XXXX-XXXX-1234", institution: "  " },
                  {
                    ...real.accounts[0]!,
                    maskedNumber: "XX9999",
                    transactions: [
                      ...real.accounts[0]!.transactions!,
                      { ...real.accounts[0]!.transactions![0]!, amount: 0.001 },
                    ],
                  },
                ],
              };
            }
          : Reflect.get(t, p, r),
    });
    const { app } = await shareBank(db, { userId, applicationId, mobile: "9876543211", financialData: broken });
    expect(app.cashflowStatus).toBe("completed");
    const view = (await getBankOverview(db, { userId, applicationId }))!;
    expect(view.numbers[0]!.session!.status).toBe("partial"); // one unreadable account left out
    expect(view.accountsShared).toBe(1);
  });

  it("two numbers ending in the same digits stay separate", async () => {
    const { userId, applicationId } = await checkedMember("samelast4");
    await shareBank(db, { userId, applicationId, mobile: "9876543211" });
    await shareBank(db, { userId, applicationId, mobile: "9123443211", outcome: "rejected" });
    const view = (await getBankOverview(db, { userId, applicationId }))!;
    expect(view.numbers.map((n) => [n.last4, n.session?.status])).toEqual([
      ["3211", "completed"],
      ["3211", "declined"],
    ]);
    expect(new Set(view.numbers.map((n) => n.key)).size).toBe(2);
  });

  it("ignores replayed returns and limits how many numbers a check can search", async () => {
    const { userId, applicationId } = await checkedMember("limits");
    const { reference } = await shareBank(db, { userId, applicationId, mobile: "9876543211" });
    const before = await rowsOf(cashflowAccounts, applicationId);
    await completeCashflowSharing({ db, financialData }, { userId, params: { reference, status: "rejected" } });
    expect((await getApplication(db, { userId, applicationId }))!.cashflowStatus).toBe("completed");
    expect(await rowsOf(cashflowAccounts, applicationId)).toBe(before);
    await shareBank(db, { userId, applicationId, mobile: "9876543212" });
    await shareBank(db, { userId, applicationId, mobile: "9876543213" });
    await expect(
      startCashflowSharing({ db, financialData }, { userId, applicationId, redirectUri: "x", mobile: "9876543214" }),
    ).rejects.toMatchObject({ code: "number_limit" });
  });

  it("asks to share again if the Account Aggregator was switched mid-flow", async () => {
    const { userId, applicationId } = await checkedMember("aaswitch");
    const { redirectUrl } = await startCashflowSharing(
      { db, financialData },
      { userId, applicationId, redirectUri: "http://localhost/cb", mobile: "9876543211" },
    );
    const reference = new URL(redirectUrl, "http://x").searchParams.get("reference")!;
    const switched = new Proxy(financialData, {
      get: (t, p, r) => (p === "descriptor" ? { ...t.descriptor, key: "aa_b" } : Reflect.get(t, p, r)),
    });
    const accounts = "3211-0";
    // While the issuing config can still serve, the return leg completes with it.
    const pinned = await checkedMember("aapinned");
    const started = await startCashflowSharing(
      { db, financialData },
      { ...pinned, redirectUri: "http://localhost/cb", mobile: "9876543211" },
    );
    const pinnedRef = new URL(started.redirectUrl, "http://x").searchParams.get("reference")!;
    await expect(
      completeCashflowSharing(
        {
          db,
          financialData: switched,
          financialDataFor: async (key: string) => (key === "mock" ? financialData : null),
        },
        { userId: pinned.userId, params: { reference: pinnedRef, status: "approved", accounts } },
      ),
    ).resolves.toMatchObject({ cashflowStatus: "completed" });

    // When it can't, the creator is asked to share again.
    await expect(
      completeCashflowSharing(
        { db, financialData: switched, financialDataFor: async () => null },
        { userId, params: { reference, status: "approved", accounts } },
      ),
    ).rejects.toMatchObject({ code: "provider_changed", applicationId });
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, applicationId));
    expect(app).toMatchObject({ cashflowStatus: "unavailable" });
    // Sharing again with the current provider works.
    expect((await shareBank(db, { userId, applicationId, mobile: "9123456781" })).app.cashflowStatus).toBe("completed");
  });

  it("is visible only to its owner", async () => {
    const { applicationId } = await checkedMember("owner");
    const other = await member("other");
    expect(await getApplication(db, { userId: other, applicationId })).toBeNull();
    expect(await getFinancialCapacity(db, { userId: other, applicationId })).toBeNull();
    expect(await getBankOverview(db, { userId: other, applicationId })).toBeNull();
    await expect(saveApplicationDetails({ db }, { userId: other, applicationId, details })).rejects.toMatchObject({
      code: "consent_required",
    });
  });
});

async function inputsLeft(applicationId: string) {
  const [b] = await db
    .select({ n: count() })
    .from(bureauSummaries)
    .where(eq(bureauSummaries.applicationId, applicationId));
  const [m] = await db
    .select({ n: count() })
    .from(cashflowMonths)
    .where(eq(cashflowMonths.applicationId, applicationId));
  const [f] = await db
    .select({ n: count() })
    .from(financialFeatures)
    .where(eq(financialFeatures.applicationId, applicationId));
  return (
    b!.n + m!.n + f!.n + (await rowsOf(cashflowAccounts, applicationId)) + (await rowsOf(fiTransactions, applicationId))
  );
}

describe("closing, expiry and withdrawal", () => {
  it("closing erases inputs and leaves a tombstone that can't be deleted", async () => {
    const { userId, applicationId } = await checkedMember("close");
    await shareBank(db, { userId, applicationId });
    await closeApplication({ db }, { userId, applicationId });
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, applicationId));
    expect(app).toMatchObject({
      status: "withdrawn",
      requestedAmount: null,
      declaredMonthlyIncome: null,
      declaredMonthlyEmi: null,
      incomeSources: [],
      panMasked: null,
      purposeNote: null,
    });
    expect(await rowsOf(fiTransactions, applicationId)).toBe(0);
    expect(app!.inputsErasedAt).not.toBeNull();
    expect(await inputsLeft(applicationId)).toBe(0);
    await expect(db.delete(creditApplications).where(eq(creditApplications.id, applicationId))).rejects.toThrow();
    expect(await getOpenApplication({ db }, userId)).toBeNull();
  });

  it("expires unsent checks after 90 days and erases their inputs", async () => {
    const { userId, applicationId } = await checkedMember("expiry");
    const later = new Date(Date.now() + 91 * 86_400_000);
    expect(await expireStaleApplications({ db, now: later }, { userId })).toBe(1);
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, applicationId));
    expect(app).toMatchObject({ status: "expired", requestedAmount: null });
    expect(await inputsLeft(applicationId)).toBe(0);
  });

  it("withdrawing the consent closes the check and erases its inputs", async () => {
    const { userId, applicationId } = await checkedMember("withdraw");
    const result = await withdrawPurpose(
      { db },
      { userId, key: CONSENT_KEYS.financialEligibility, source: "settings" },
    );
    expect(result.effects).toEqual({ checks_closed: 1 });
    expect(result.erasures).toEqual([{ scope: "financial_inputs", status: "completed", holdReasons: [] }]);
    expect((await getApplication(db, { userId, applicationId }))!.status).toBe("withdrawn");
    expect(await inputsLeft(applicationId)).toBe(0);
    await expect(saveApplicationDetails({ db }, { userId, applicationId, details })).rejects.toMatchObject({
      code: "consent_required",
    });
  });

  it("defers erasure while a check is with a partner lender", async () => {
    const { userId, applicationId } = await checkedMember("hold");
    await shareBank(db, { userId, applicationId });
    // Stage 12 will submit to a lender; simulate it here.
    await db.update(creditApplications).set({ status: "submitted" }).where(eq(creditApplications.id, applicationId));
    const result = await withdrawPurpose(
      { db },
      { userId, key: CONSENT_KEYS.financialEligibility, source: "settings" },
    );
    expect(result.erasures).toEqual([
      { scope: "financial_inputs", status: "deferred", holdReasons: ["credit_application_in_progress"] },
    ]);
    expect(await inputsLeft(applicationId)).toBeGreaterThan(0);
    const [profile] = await db
      .select({ status: creatorProfiles.profileStatus })
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, userId));
    expect(profile!.status).toBe("completed");
  });
});
