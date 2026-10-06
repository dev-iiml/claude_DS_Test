import { and, asc, count, desc, eq, inArray, lte } from "drizzle-orm";

import {
  bureauSummaries,
  cashflowAccounts,
  cashflowMonths,
  creditApplications,
  financialFeatureRuns,
  financialFeatures,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { callProvider, countRecentProviderCalls, recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, grantConsent, hasValidConsent } from "@/modules/consent";
import { getIdentityPrefill } from "@/modules/identity/identity-prefill";
import type { CreditBureauProvider } from "@/providers/bureau/types";

import { APPLICATION_TTL_DAYS, BUREAU_CHECKS_PER_30_DAYS, OPEN_APPLICATION_STATUSES } from "./domain";
import { eraseFinancialInputs } from "./erasure";
import {
  FIN_ENGINE_VERSION,
  computeFinancialFeatures,
  type FinFeatureKey,
  type FinancialEngineInput,
} from "./financial-features";
import { hashFinancialInputs } from "./inputs-hash";
import type { ApplicationDetailsInput } from "./schemas";
import { panFingerprint } from "./pan-fingerprint";
import {
  FinancialEligibilityError,
  audit,
  completedProfile,
  ownOpenApplication,
  reopenIfConfirmed,
  requireConsent,
  type Application,
  type FinDeps,
} from "./service-support";

export { FinancialEligibilityError, type FinDeps } from "./service-support";

/**
 * Financial eligibility (Stages 09/09b) — regulated financial domain. Collects
 * permitted inputs for one product-agnostic eligibility check and, when the
 * creator confirms them on Review, computes Financial Capacity features. It
 * never decides eligibility or a limit; that is the underwriting engine's
 * recommendation and, finally, the partner lender's decision. Bank data
 * sharing lives in `cashflow-service.ts`.
 */

const BUREAU_OPERATION = "fetch_bureau_summary";

/** The creator's open check, if any (expiring stale ones first). */
export async function getOpenApplication(deps: FinDeps, userId: string): Promise<Application | null> {
  await expireStaleApplications(deps, { userId });
  const [app] = await deps.db
    .select()
    .from(creditApplications)
    .where(
      and(eq(creditApplications.userId, userId), inArray(creditApplications.status, [...OPEN_APPLICATION_STATUSES])),
    )
    .limit(1);
  return app ?? null;
}

/** Records the financial-eligibility consent and opens a check (or returns the open one). */
export async function startApplication(
  deps: FinDeps,
  input: { userId: string; consentDefinitionId: string; source: "settings" | "api" },
) {
  const now = deps.now ?? new Date();
  const creatorId = await completedProfile(deps.db, input.userId);
  const existing = await getOpenApplication(deps, input.userId);
  if (existing) {
    if (await hasValidConsent(deps.db, input.userId, CONSENT_KEYS.financialEligibility, now)) return existing;
    // The consent text changed while this check was open: record the new consent and carry on with the same check.
    return deps.db.transaction(async (tx) => {
      const receipt = await grantConsent(tx, {
        userId: input.userId,
        key: CONSENT_KEYS.financialEligibility,
        consentDefinitionId: input.consentDefinitionId,
        source: input.source,
        metadata: { surface: "eligibility_consent_renewed" },
        now,
      });
      const [app] = await tx
        .update(creditApplications)
        .set({ consentReceiptId: receipt.id })
        .where(eq(creditApplications.id, existing.id))
        .returning();
      await audit(tx, input.userId, existing.id, "financial_eligibility.consent_renewed");
      return app!;
    });
  }

  return deps.db.transaction(async (tx) => {
    const receipt = await grantConsent(tx, {
      userId: input.userId,
      key: CONSENT_KEYS.financialEligibility,
      consentDefinitionId: input.consentDefinitionId,
      source: input.source,
      metadata: { surface: "eligibility_start" },
      now,
    });
    const [app] = await tx
      .insert(creditApplications)
      .values({
        userId: input.userId,
        creatorId,
        consentReceiptId: receipt.id,
        expiresAt: new Date(now.getTime() + APPLICATION_TTL_DAYS * 86_400_000),
        createdAt: now,
      })
      .returning();
    await audit(tx, input.userId, app!.id, "financial_eligibility.started");
    return app!;
  });
}

export async function saveApplicationDetails(
  deps: FinDeps,
  input: { userId: string; applicationId: string; details: ApplicationDetailsInput },
) {
  const now = deps.now ?? new Date();
  await completedProfile(deps.db, input.userId);
  await requireConsent(deps.db, input.userId, now);
  return deps.db.transaction(async (tx) => {
    const current = await ownOpenApplication(tx, input.userId, input.applicationId, true);
    await reopenIfConfirmed(tx, current, input.userId);
    const [app] = await tx
      .update(creditApplications)
      .set({
        purpose: input.details.purposes[0]!,
        purposes: input.details.purposes,
        purposeNote: input.details.purposeNote,
        requestedAmount: input.details.requestedAmount,
        declaredMonthlyIncome: input.details.declaredMonthlyIncome,
        declaredMonthlyEmi: input.details.declaredMonthlyEmi,
        incomeSources: input.details.incomeSources,
        detailsCompletedAt: now,
      })
      .where(eq(creditApplications.id, input.applicationId))
      .returning();
    // The note is free text: never audited.
    await audit(tx, input.userId, app!.id, "financial_eligibility.details_saved", {
      purpose: input.details.purposes[0]!,
      purposes: input.details.purposes.length,
    });
    return app!;
  });
}

/**
 * Bureau summary via the partner bureau. The PAN is used for this call and to
 * derive a masked PAN and a keyed fingerprint (duplicate checks); the PAN
 * itself is never stored, logged or returned. If the creator verified their
 * identity, the PAN must match the masked PAN on record.
 */
export async function runBureauCheck(
  deps: FinDeps & { bureau: CreditBureauProvider },
  input: { userId: string; applicationId: string; pan: string },
) {
  const now = deps.now ?? new Date();
  await completedProfile(deps.db, input.userId);
  await requireConsent(deps.db, input.userId, now);
  const app = await ownOpenApplication(deps.db, input.userId, input.applicationId);
  if (!app.detailsCompletedAt) throw new FinancialEligibilityError("wrong_step", "Add your details first.");

  const recent = await countRecentProviderCalls(deps.db, {
    userId: input.userId,
    operation: BUREAU_OPERATION,
    since: new Date(now.getTime() - 30 * 86_400_000),
  });
  if (recent >= BUREAU_CHECKS_PER_30_DAYS) {
    throw new FinancialEligibilityError(
      "bureau_limit",
      "You've reached the limit of credit checks for now. Please try again later.",
    );
  }

  const panMasked = `XXXXX${input.pan.slice(5)}`;
  // Derived before the bureau call, so a misconfigured secret fails before an enquiry is spent.
  const fingerprint = panFingerprint(input.pan);
  const verified = await getIdentityPrefill(deps.db, input.userId);
  if (verified && verified.panMasked !== panMasked) {
    throw new FinancialEligibilityError(
      "pan_mismatch",
      "This PAN doesn't match the one linked to your verified identity.",
    );
  }

  let summary;
  try {
    summary = await callProvider(
      deps.db,
      {
        userId: input.userId,
        provider: deps.bureau.descriptor,
        operation: BUREAU_OPERATION,
        consentReceiptId: app.consentReceiptId,
      },
      () => deps.bureau.fetchSummary({ subjectRef: input.pan, consentReceiptId: app.consentReceiptId }),
      (r) => ({ outcome: r.scoreBand === "no_hit" ? "not_found" : "success", reference: r.reference }),
    );
  } catch {
    throw new FinancialEligibilityError("provider_error", "The credit bureau didn't respond. Please try again.");
  }

  return deps.db.transaction(async (tx) => {
    const locked = await ownOpenApplication(tx, input.userId, app.id, true);
    await reopenIfConfirmed(tx, locked, input.userId);
    const values = {
      provider: deps.bureau.descriptor.key,
      providerReference: summary.reference,
      scoreBand: summary.scoreBand,
      activeTradelines: summary.activeTradelines,
      delinquentTradelines12m: summary.delinquentTradelines12m,
      enquiries6m: summary.enquiries6m,
      retrievedAt: summary.retrievedAt,
    };
    await tx
      .insert(bureauSummaries)
      .values({ applicationId: app.id, ...values })
      .onConflictDoUpdate({ target: bureauSummaries.applicationId, set: values });
    const [updated] = await tx
      .update(creditApplications)
      .set({ panMasked, panFingerprint: fingerprint, bureauStatus: "completed" })
      .where(eq(creditApplications.id, app.id))
      .returning();
    await audit(tx, input.userId, app.id, "financial_eligibility.bureau_checked");
    return updated!;
  });
}

/** True when every input is in and the creator can confirm on Review. */
export function readyToConfirm(
  app: Pick<Application, "detailsCompletedAt" | "bureauStatus" | "cashflowStatus" | "accountsCompleteDeclared">,
) {
  return (
    app.detailsCompletedAt !== null &&
    app.bureauStatus === "completed" &&
    (app.cashflowStatus === "skipped" ||
      // Shared data needs the creator's answer on whether every income account is in.
      (app.cashflowStatus === "completed" && app.accountsCompleteDeclared !== null))
  );
}

/**
 * The creator confirms their inputs on Review (Stage 09b: explicit, never
 * automatic). Computes Financial Capacity from exactly these inputs and marks
 * the check ready for a recommendation. Idempotent.
 */
export async function confirmApplication(deps: FinDeps, input: { userId: string; applicationId: string }) {
  const now = deps.now ?? new Date();
  await completedProfile(deps.db, input.userId);
  await requireConsent(deps.db, input.userId, now);
  return deps.db.transaction(async (tx) => {
    const app = await ownOpenApplication(tx, input.userId, input.applicationId, true);
    if (!readyToConfirm(app)) throw new FinancialEligibilityError("wrong_step", "Some steps aren't finished yet.");
    return finalise(tx, app, now);
  });
}

/** Closes a check at the creator's request and erases its inputs straight away. */
export async function closeApplication(deps: FinDeps, input: { userId: string; applicationId: string }) {
  const now = deps.now ?? new Date();
  return deps.db.transaction(async (tx) => {
    const app = await ownOpenApplication(tx, input.userId, input.applicationId);
    await tx
      .update(creditApplications)
      .set({ status: "withdrawn", closedAt: now })
      .where(eq(creditApplications.id, app.id));
    const erased = await eraseFinancialInputs(tx, { userId: input.userId, applicationId: app.id, now });
    await audit(tx, input.userId, app.id, "financial_eligibility.closed", erased);
  });
}

/** Closes every open check (used when the financial-eligibility consent is withdrawn). */
export async function closeOpenApplications(tx: DbExecutor, input: { userId: string; now: Date }) {
  const closed = await tx
    .update(creditApplications)
    .set({ status: "withdrawn", closedAt: input.now })
    .where(
      and(
        eq(creditApplications.userId, input.userId),
        inArray(creditApplications.status, [...OPEN_APPLICATION_STATUSES]),
      ),
    )
    .returning({ id: creditApplications.id });
  return closed.length;
}

/**
 * Unsent checks expire after APPLICATION_TTL_DAYS and their inputs are erased
 * (user decision). Runs lazily per creator and as a sweep for a scheduled job.
 */
export async function expireStaleApplications(deps: FinDeps, input: { userId?: string } = {}) {
  const now = deps.now ?? new Date();
  const stale = await deps.db
    .select({ id: creditApplications.id, userId: creditApplications.userId })
    .from(creditApplications)
    .where(
      and(
        inArray(creditApplications.status, [...OPEN_APPLICATION_STATUSES]),
        lte(creditApplications.expiresAt, now),
        input.userId ? eq(creditApplications.userId, input.userId) : undefined,
      ),
    );
  for (const app of stale) {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(creditApplications)
        .set({ status: "expired", closedAt: now })
        .where(eq(creditApplications.id, app.id));
      const erased = await eraseFinancialInputs(tx, { userId: app.userId, applicationId: app.id, now });
      await recordAuditEvent(tx, {
        actorType: "system",
        eventType: "financial_eligibility.expired",
        entityType: "credit_application",
        entityId: app.id,
        metadata: erased,
      });
    });
  }
  return stale.length;
}

// ---------------------------------------------------------------------------
// Financial Capacity
// ---------------------------------------------------------------------------

export async function loadFinancialEngineInput(
  db: DbExecutor,
  app: Application,
  asOf: string,
): Promise<FinancialEngineInput> {
  const [bureau] = await db.select().from(bureauSummaries).where(eq(bureauSummaries.applicationId, app.id)).limit(1);
  const months = await db
    .select()
    .from(cashflowMonths)
    .where(eq(cashflowMonths.applicationId, app.id))
    .orderBy(asc(cashflowMonths.month));
  return {
    asOf,
    declared: {
      monthlyIncome: app.declaredMonthlyIncome ?? 0,
      monthlyEmi: app.declaredMonthlyEmi ?? 0,
      incomeSources: app.incomeSources,
    },
    bureau: bureau
      ? {
          scoreBand: bureau.scoreBand,
          activeTradelines: bureau.activeTradelines,
          delinquentTradelines12m: bureau.delinquentTradelines12m,
          enquiries6m: bureau.enquiries6m,
        }
      : null,
    cashflow: months.map((m) => ({
      month: m.month.slice(0, 7),
      inflow: m.inflowTotal,
      outflow: m.outflowTotal,
      creatorIncome: m.creatorIncomeInflow,
    })),
    coverage: await coverageOf(db, app),
  };
}

async function coverageOf(db: DbExecutor, app: Application): Promise<FinancialEngineInput["coverage"]> {
  const accounts = await db
    .select({ status: cashflowAccounts.status })
    .from(cashflowAccounts)
    .where(eq(cashflowAccounts.applicationId, app.id));
  const shared = accounts.filter((a) => a.status === "delivered").length;
  return {
    status: shared === 0 ? "none" : (app.cashflowCoverage ?? "partial"),
    accountsShared: shared,
    accountsNotReceived: accounts.length - shared,
  };
}

async function finalise(tx: DbExecutor, app: Application, now: Date) {
  const engineInput = await loadFinancialEngineInput(tx, app, now.toISOString().slice(0, 10));
  const inputsHash = hashFinancialInputs(engineInput);
  const [existing] = await tx
    .select({ id: financialFeatureRuns.id })
    .from(financialFeatureRuns)
    .where(
      and(
        eq(financialFeatureRuns.applicationId, app.id),
        eq(financialFeatureRuns.engineVersion, FIN_ENGINE_VERSION),
        eq(financialFeatureRuns.inputsHash, inputsHash),
      ),
    )
    .limit(1);
  let runId = existing?.id;
  if (!existing) {
    const [run] = await tx
      .insert(financialFeatureRuns)
      .values({ applicationId: app.id, engineVersion: FIN_ENGINE_VERSION, inputsHash, computedAt: now })
      .returning({ id: financialFeatureRuns.id });
    await tx.insert(financialFeatures).values(
      computeFinancialFeatures(engineInput).map((f) => ({
        runId: run!.id,
        applicationId: app.id,
        featureKey: f.key,
        featureVersion: f.version,
        valueNumeric: typeof f.value === "number" ? String(f.value) : null,
        valueText: typeof f.value === "string" ? f.value : null,
        unit: f.unit,
        source: f.source,
        completeness: String(f.completeness),
        confidence: f.confidence,
        provenance: f.provenance,
      })),
    );
    runId = run!.id;
  }
  if (app.status === "inputs_ready" && app.financialRunId === runId) return app;
  const [updated] = await tx
    .update(creditApplications)
    // The confirmed run is pinned: an identical earlier run is reused, never a later one with other inputs.
    .set({ status: "inputs_ready", inputsReadyAt: now, financialRunId: runId! })
    .where(eq(creditApplications.id, app.id))
    .returning();
  await recordAuditEvent(tx, {
    actorType: "system",
    eventType: "financial_eligibility.inputs_ready",
    entityType: "credit_application",
    entityId: app.id,
    metadata: {
      engine_version: FIN_ENGINE_VERSION,
      cashflow: app.cashflowStatus,
      coverage: app.cashflowCoverage ?? "none",
    },
  });
  return updated!;
}

export interface StoredFinFeature {
  key: FinFeatureKey;
  value: number | string | null;
  unit: string;
  source: string;
  confidence: string;
  completeness: number;
}

/** Latest Financial Capacity run for an application the user owns. */
export async function getFinancialCapacity(db: DbExecutor, input: { userId: string; applicationId: string }) {
  const [app] = await db
    .select({ financialRunId: creditApplications.financialRunId })
    .from(creditApplications)
    .where(and(eq(creditApplications.id, input.applicationId), eq(creditApplications.userId, input.userId)))
    .limit(1);
  if (!app) return null;
  // The run the creator last confirmed; otherwise (a check reopened, or confirmed before 09b) the latest.
  const [run] = await db
    .select({
      id: financialFeatureRuns.id,
      engineVersion: financialFeatureRuns.engineVersion,
      computedAt: financialFeatureRuns.computedAt,
    })
    .from(financialFeatureRuns)
    .where(
      and(
        eq(financialFeatureRuns.applicationId, input.applicationId),
        app.financialRunId ? eq(financialFeatureRuns.id, app.financialRunId) : undefined,
      ),
    )
    .orderBy(desc(financialFeatureRuns.computedAt), desc(financialFeatureRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const rows = await db.select().from(financialFeatures).where(eq(financialFeatures.runId, run.id));
  const features: StoredFinFeature[] = rows.map((r) => ({
    key: r.featureKey as FinFeatureKey,
    value: r.valueText ?? (r.valueNumeric === null ? null : Number(r.valueNumeric)),
    unit: r.unit,
    source: r.source,
    confidence: r.confidence,
    completeness: Number(r.completeness),
  }));
  return { runId: run.id, engineVersion: run.engineVersion, computedAt: run.computedAt, features };
}

/** An application the user owns (any status), for display. No PAN beyond the masked form. */
export async function getApplication(db: DbExecutor, input: { userId: string; applicationId: string }) {
  const [app] = await db
    .select()
    .from(creditApplications)
    .where(and(eq(creditApplications.id, input.applicationId), eq(creditApplications.userId, input.userId)))
    .limit(1);
  if (!app) return null;
  const [bureau] = await db
    .select({ scoreBand: bureauSummaries.scoreBand })
    .from(bureauSummaries)
    .where(eq(bureauSummaries.applicationId, app.id))
    .limit(1);
  const months = await db
    .select({ month: cashflowMonths.month })
    .from(cashflowMonths)
    .where(eq(cashflowMonths.applicationId, app.id));
  return { ...app, bureauScoreBand: bureau?.scoreBand ?? null, cashflowMonthsCount: months.length };
}

/** The creator's checks, newest first (status and dates only). */
export async function listApplications(db: DbExecutor, userId: string) {
  return db
    .select({
      id: creditApplications.id,
      status: creditApplications.status,
      purpose: creditApplications.purpose,
      createdAt: creditApplications.createdAt,
      closedAt: creditApplications.closedAt,
      expiresAt: creditApplications.expiresAt,
      inputsErasedAt: creditApplications.inputsErasedAt,
    })
    .from(creditApplications)
    .where(eq(creditApplications.userId, userId))
    .orderBy(desc(creditApplications.createdAt));
}

/** Aggregate counts for the risk console (no applicant data). */
export async function countApplicationsByStatus(db: DbExecutor) {
  return db
    .select({ status: creditApplications.status, n: count() })
    .from(creditApplications)
    .groupBy(creditApplications.status);
}
