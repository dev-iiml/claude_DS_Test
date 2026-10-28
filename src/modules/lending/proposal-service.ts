import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  auditEvents,
  consentReceipts,
  creditApplications,
  creditProposals,
  decisionQueries,
  partners,
  decisionReviews,
  lenderDecisions,
  offerResponses,
  underwritingRuns,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { recordEvent } from "@/modules/analytics";
import { CONSENT_KEYS, findValidReceipt, getActiveDefinition, hasValidConsent } from "@/modules/consent";
import { getFinancialCapacity } from "@/modules/financial-eligibility/application-service";
import { recordPartnerEvent } from "@/modules/partners";
import { FRAUD_RULES_VERSION } from "@/modules/fraud/rules";
import { PROFESSIONAL_INPUTS, getUnderwritingRun } from "@/modules/underwriting/underwriting-service";
import { classifyProviderError } from "@/providers/errors";
import type { ProposalDataGroup, ProposalModelResult, ProposalPayload } from "@/providers/lender/proposal";
import type { CreditProposal, LenderProvider } from "@/providers/lender/types";
import {
  canonicalTerms,
  offerTermsSchema,
  repriceIllustrative,
  type Offer,
  type OfferTerms,
} from "@/providers/lender/offer";

import {
  MAX_SEND_ATTEMPTS,
  OUTCOME_RANK,
  MAX_OFFER_VALIDITY_DAYS,
  QUERY_MESSAGE_MAX,
  QUERY_MESSAGE_MIN,
  SENDING_LEASE_MS,
  UNSENT_PROPOSAL_STATUSES,
  reviewActionsFor,
  sendRetryDelayMs,
  uncoveredGroups,
  type DecisionOutcome,
  type OfferDeclineReason,
  type OfferState,
  type WithdrawReason,
} from "./domain";
import { buildProposalPayload, canonicalJson } from "./payload";
import { getActivePolicy, getPolicyVersion } from "./policy-service";

/**
 * Lender orchestration (Stage 12). With the creator's "Share with a partner
 * lender" consent, a confirmed check becomes a credit proposal: fraud-review
 * cases wait for a risk admin to release them, the rest are sent at once
 * (user decision). The lender decides; a risk admin confirms or overrides
 * before the creator sees the outcome. Proposals are frozen when created.
 *
 * Writes to the `fin` schema (proposals, decisions, reviews) alongside
 * financial-eligibility and underwriting.
 */

export class LendingError extends Error {
  constructor(
    readonly code: "not_found" | "wrong_state" | "invalid" | "consent_required" | "provider_changed" | "conflict",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "LendingError";
  }
}

export interface LendingDeps {
  db: Database;
  lender: LenderProvider;
  /** The provider for a config key: finishes work begun with a lender config that is no longer primary. */
  lenderFor?: (key: string) => Promise<LenderProvider | null>;
  now?: Date;
}

type Proposal = typeof creditProposals.$inferSelect;
/** A run has at most one proposal that isn't withdrawn (a failed one waits for staff to retry it). */
const LIVE_EXCLUDED = ["withdrawn"] as const;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function audit(
  db: DbExecutor,
  actor: { type: "user" | "system"; id?: string },
  proposalId: string,
  eventType: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  await recordAuditEvent(db, {
    actorType: actor.type,
    actorId: actor.id,
    eventType,
    entityType: "credit_proposal",
    entityId: proposalId,
    metadata,
  });
}

/** The creator's current "Share with a partner lender" receipt and the version it's for. */
async function sharingConsent(db: DbExecutor, userId: string, now: Date) {
  const definition = await getActiveDefinition(db, CONSENT_KEYS.lenderSharing, now);
  if (!definition) return null;
  const receipt = await findValidReceipt(db, userId, CONSENT_KEYS.lenderSharing, now);
  return receipt ? { receiptId: receipt.id, version: definition.version } : null;
}

const modelResult = (
  r: NonNullable<Awaited<ReturnType<typeof getUnderwritingRun>>>["traditional"],
  model: ProposalModelResult["model"],
  modelVersion: string,
): ProposalModelResult | null =>
  r
    ? {
        model,
        modelVersion,
        score: r.score,
        grade: r.grade,
        outcome: r.outcome as ProposalModelResult["outcome"],
        completeness: r.completeness,
        confidence: r.confidence,
        recommendedExposure: r.recommendedExposure,
        maxRecommendedExposure: r.maxRecommendedExposure,
        recommendedTenorMonths: r.recommendedTenorMonths,
        components: r.components,
        reasonCodes: r.reasonCodes.map((c) => c.code),
      }
    : null;

/** The lender config's proposal profile, or null when no lender can serve (unconfigured, paused, broken). */
function profileOf(lender: LenderProvider): readonly ProposalDataGroup[] | null {
  if (lender.descriptor.key === "unconfigured") return null;
  try {
    const p = lender.proposalProfile();
    return Array.isArray(p) && p.length ? p : null;
  } catch {
    return null;
  }
}

async function latestRunFor(db: DbExecutor, applicationId: string, financialRunId: string) {
  const [run] = await db
    .select({ id: underwritingRuns.id })
    .from(underwritingRuns)
    .where(and(eq(underwritingRuns.applicationId, applicationId), eq(underwritingRuns.financialRunId, financialRunId)))
    .orderBy(desc(underwritingRuns.computedAt), desc(underwritingRuns.createdAt))
    .limit(1);
  return run?.id ?? null;
}

/**
 * Prepares a proposal for the creator's confirmed check when they share with
 * a partner lender, then sends it unless it needs a fraud review. Idempotent:
 * one live proposal per underwriting run. Returns null when there is nothing
 * to propose (not shared, not confirmed, no recommendation yet).
 */
export async function proposeIfShared(
  deps: LendingDeps,
  input: { userId: string; applicationId: string },
): Promise<Proposal | null> {
  const now = deps.now ?? new Date();
  const db = deps.db;
  const consent = await sharingConsent(db, input.userId, now);
  if (!consent) return null;
  const [app] = await db
    .select()
    .from(creditApplications)
    .where(and(eq(creditApplications.id, input.applicationId), eq(creditApplications.userId, input.userId)))
    .limit(1);
  if (!app || app.status !== "inputs_ready" || !app.financialRunId) return null;
  const runId = await latestRunFor(db, app.id, app.financialRunId);
  if (!runId) return null;

  const [live] = await db
    .select()
    .from(creditProposals)
    .where(and(eq(creditProposals.underwritingRunId, runId), notInArray(creditProposals.status, [...LIVE_EXCLUDED])))
    .limit(1);
  if (live) return live.status === "queued" ? sendProposal(deps, live.id) : live;

  const configured = profileOf(deps.lender);
  if (!configured) return null; // no lender can serve right now; the sweep tries again
  const profile = [...new Set<ProposalDataGroup>(["request", ...configured])];
  const uncovered = uncoveredGroups(profile, consent.version);
  if (uncovered.length) {
    const already = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, app.id),
          eq(auditEvents.eventType, "lending.proposal_blocked"),
          sql`${auditEvents.createdAt} >= ${(app.inputsReadyAt ?? now).toISOString()}::timestamptz`,
        ),
      )
      .limit(1);
    if (already.length) return null;
    // The partnership asks for more than the creator agreed to share: never send it.
    await recordAuditEvent(db, {
      actorType: "system",
      eventType: "lending.proposal_blocked",
      entityType: "credit_application",
      entityId: app.id,
      metadata: { reason: "consent_scope", groups: uncovered.length },
    });
    return null;
  }

  const run = await getUnderwritingRun(db, runId);
  const capacity = await getFinancialCapacity(db, { userId: input.userId, applicationId: app.id });
  if (!run || !capacity) return null;
  const feature = (k: string) => capacity.features.find((f) => f.key === k)?.value;
  const professionalKeys = new Set<string>(PROFESSIONAL_INPUTS);
  const proposalId = randomUUID();
  const payload = buildProposalPayload({
    proposalId,
    applicationRef: app.id,
    createdAt: now,
    groups: profile,
    versions: {
      underwriting: run.modelVersion,
      financialCapacity: capacity.engineVersion,
      fraudRules: run.fraud?.rulesVersion ?? FRAUD_RULES_VERSION,
    },
    request: { requestedAmount: app.requestedAmount, purposes: app.purposes },
    financialCapacity: capacity.features.map((f) => ({
      key: f.key,
      value: f.value,
      unit: f.unit,
      confidence: f.confidence,
    })),
    models: {
      traditional: modelResult(run.traditional, "traditional", run.modelVersion),
      creatorEnhanced: modelResult(run.creatorEnhanced, "creator_enhanced", run.modelVersion),
    },
    bankCoverage: {
      status: (feature("bank_coverage") as "none" | "partial" | "complete" | undefined) ?? "none",
      accountsShared: Number(feature("bank_accounts_shared") ?? 0),
      accountsNotReceived: Number(feature("bank_accounts_not_received") ?? 0),
    },
    fraud: {
      outcome: run.fraud?.outcome ?? "clear",
      flags: (run.fraud?.flags ?? []).map((f) => ({ code: f.code, severity: f.severity, evidence: f.evidence })),
    },
    professionalFeatures: Object.fromEntries(
      run.inputs.filter((i) => professionalKeys.has(i.key)).map((i) => [i.key, i.value]),
    ),
  });
  const review = run.fraud?.outcome === "review";

  const created = await db.transaction(async (tx) => {
    // Older unsent proposals for this check no longer reflect what the creator confirmed.
    await withdrawUnsent(tx, { applicationId: app.id, reason: "inputs_changed", exceptRunId: runId });
    const [row] = await tx
      .insert(creditProposals)
      .values({
        id: proposalId,
        applicationId: app.id,
        underwritingRunId: runId,
        lender: deps.lender.descriptor.key,
        status: review ? "held" : "queued",
        holdReason: review ? "fraud_review" : null,
        dataGroups: payload.dataGroups,
        consentReceiptId: consent.receiptId,
        payload: payload as unknown as Record<string, unknown>,
        payloadHash: sha256(canonicalJson(payload)),
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await audit(tx, { type: "system" }, row.id, "lending.proposal_created", {
        status: row.status,
        groups: payload.dataGroups.length,
      });
    }
    return row ?? null;
  });
  if (!created) return null; // a concurrent request created it
  return created.status === "queued" ? sendProposal(deps, created.id) : created;
}

/** Proposals for every confirmed check of this creator (after the sharing consent is given). */
export async function proposeForConfirmedChecks(deps: LendingDeps, input: { userId: string }) {
  const apps = await deps.db
    .select({ id: creditApplications.id })
    .from(creditApplications)
    .where(and(eq(creditApplications.userId, input.userId), eq(creditApplications.status, "inputs_ready")));
  const out: Proposal[] = [];
  for (const a of apps) {
    const p = await proposeIfShared(deps, { userId: input.userId, applicationId: a.id });
    if (p) out.push(p);
  }
  return out;
}

/** A lender's offer as stored: validated terms, or nothing (declined, or malformed — never shown). */
function storableOffer(outcome: string, offer: Offer | null | undefined) {
  if (outcome === "declined" || !offer) return { offerTerms: null, offerExpiresAt: null };
  const parsed = offerTermsSchema.safeParse(offer.terms);
  if (!parsed.success || Number.isNaN(offer.expiresAt.getTime())) return { offerTerms: null, offerExpiresAt: null };
  return { offerTerms: parsed.data as unknown as Record<string, unknown>, offerExpiresAt: offer.expiresAt };
}

export const termsHashOf = (terms: OfferTerms) => sha256(canonicalTerms(terms));
const termsOf = (raw: Record<string, unknown> | null): OfferTerms | null => {
  if (!raw) return null;
  const parsed = offerTermsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

function decisionDeliveryOf(lender: LenderProvider): "poll" | "push" {
  try {
    return lender.decisionDelivery?.() === "push" ? "push" : "poll";
  } catch {
    return "poll";
  }
}

async function lenderForProposal(deps: LendingDeps, proposal: Proposal) {
  if (proposal.lender === deps.lender.descriptor.key) return deps.lender;
  return (deps.lenderFor ? await deps.lenderFor(proposal.lender) : null) ?? null;
}

async function creditProposalFor(
  db: DbExecutor,
  proposal: Proposal,
  lender: LenderProvider,
  policyVersion?: number | null,
) {
  const payload = proposal.payload as unknown as ProposalPayload;
  if (lender.descriptor.mode !== "mock") return { proposalId: proposal.id, payload } satisfies CreditProposal;
  const policy =
    policyVersion != null
      ? {
          version: policyVersion,
          rules: (await getPolicyVersion(db, policyVersion)) ?? (await getActivePolicy(db)).rules,
        }
      : await getActivePolicy(db);
  return {
    proposalId: proposal.id,
    payload,
    simulation: { policy: policy.rules, policyVersion: policy.version },
  } satisfies CreditProposal;
}

/**
 * Sends a queued proposal. In one transaction it locks the proposal and the
 * check, re-checks that both consents still hold and that the check is still
 * exactly what was confirmed, then marks the proposal `sending` and the check
 * `submitted` — so nothing can change or cancel it while the lender call is
 * in flight. A failed call puts both back; a successful one keeps the record.
 */
export async function sendProposal(deps: LendingDeps, proposalId: string): Promise<Proposal> {
  const now = deps.now ?? new Date();
  const db = deps.db;
  const current = async () => (await db.select().from(creditProposals).where(eq(creditProposals.id, proposalId)))[0]!;

  const claim = await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(creditProposals)
      .where(
        and(
          eq(creditProposals.id, proposalId),
          eq(creditProposals.status, "queued"),
          or(isNull(creditProposals.nextAttemptAt), lte(creditProposals.nextAttemptAt, now)),
        ),
      )
      .for("update");
    if (!p) return null;
    const [app] = await tx
      .select()
      .from(creditApplications)
      .where(eq(creditApplications.id, p.applicationId))
      .for("update");
    const [run] = await tx
      .select({ financialRunId: underwritingRuns.financialRunId })
      .from(underwritingRuns)
      .where(eq(underwritingRuns.id, p.underwritingRunId));
    const [receipt] = await tx
      .select({ status: consentReceipts.status })
      .from(consentReceipts)
      .where(eq(consentReceipts.id, p.consentReceiptId));
    const eligibilityConsent = app
      ? await hasValidConsent(tx, app.userId, CONSENT_KEYS.financialEligibility, now)
      : false;
    const stale: WithdrawReason | null =
      receipt?.status !== "granted"
        ? "consent_withdrawn"
        : !app || !eligibilityConsent || (app.status !== "inputs_ready" && app.status !== "draft")
          ? "check_closed"
          : app.status === "draft" || app.financialRunId !== run?.financialRunId
            ? "inputs_changed"
            : null;
    if (stale) {
      const [row] = await tx
        .update(creditProposals)
        .set({ status: "withdrawn", withdrawnReason: stale, nextAttemptAt: null })
        .where(eq(creditProposals.id, p.id))
        .returning();
      await audit(tx, { type: "system" }, p.id, "lending.proposal_withdrawn", { reason: stale });
      return { stale: row! };
    }
    const [sending] = await tx
      .update(creditProposals)
      .set({ status: "sending", nextAttemptAt: null })
      .where(eq(creditProposals.id, p.id))
      .returning();
    // Locks the check for the duration: not open → no edits, no discard, no expiry; retention hold applies.
    await tx.update(creditApplications).set({ status: "submitted" }).where(eq(creditApplications.id, app!.id));
    return { sending: sending! };
  });
  if (!claim) return current();
  if ("stale" in claim) return claim.stale!;
  const proposal = claim.sending;

  const lender = await lenderForProposal(deps, proposal);
  if (!lender) return recordSendFailure(db, proposal, "provider_changed", now);
  let credit: CreditProposal;
  let reference: string;
  try {
    credit = await creditProposalFor(db, proposal, lender);
    reference = (await lender.submitProposal(credit)).lenderReference;
  } catch (error) {
    return recordSendFailure(db, proposal, classifyProviderError(error), now);
  }

  const sent = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(creditProposals)
      .set({
        status: "submitted",
        lenderReference: reference,
        submittedAt: now,
        policyVersion: credit.simulation?.policyVersion ?? null,
        attempts: proposal.attempts + 1,
        lastError: null,
      })
      .where(and(eq(creditProposals.id, proposal.id), eq(creditProposals.status, "sending")))
      .returning();
    if (row) {
      await audit(tx, { type: "system" }, row.id, "lending.proposal_submitted", { lender: row.lender });
      // Partner-API lenders (12b): a thin, signed "proposal.submitted" webhook; no-op for lenders without a partner.
      await recordPartnerEvent(tx, { lenderKey: row.lender, type: "proposal.submitted", proposalId: row.id, now });
    }
    return row ?? null;
  });
  if (!sent) return current();
  return collectDecision(deps, sent.id);
}

/** A send attempt failed (or was interrupted): back to the queue with backoff, or `failed`; the check reopens. */
async function recordSendFailure(db: Database, proposal: Proposal, errorClass: string, now: Date) {
  const attempts = proposal.attempts + 1;
  const failed = attempts >= MAX_SEND_ATTEMPTS;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(creditProposals)
      .set({
        attempts,
        status: failed ? "failed" : "queued",
        lastError: errorClass.slice(0, 40),
        nextAttemptAt: failed ? null : new Date(now.getTime() + sendRetryDelayMs(attempts)),
      })
      .where(and(eq(creditProposals.id, proposal.id), eq(creditProposals.status, "sending")))
      .returning();
    if (!row) return (await tx.select().from(creditProposals).where(eq(creditProposals.id, proposal.id)))[0]!;
    // Nothing reached the lender: the check is open again (unless another proposal for it was sent).
    const [sentOther] = await tx
      .select({ id: creditProposals.id })
      .from(creditProposals)
      .where(
        and(
          eq(creditProposals.applicationId, proposal.applicationId),
          inArray(creditProposals.status, ["sending", "submitted", "decided"]),
        ),
      )
      .limit(1);
    if (!sentOther) {
      await tx
        .update(creditApplications)
        .set({ status: "inputs_ready" })
        .where(and(eq(creditApplications.id, proposal.applicationId), eq(creditApplications.status, "submitted")));
    }
    await audit(tx, { type: "system" }, proposal.id, failed ? "lending.proposal_failed" : "lending.proposal_retry", {
      attempts,
      error: errorClass.slice(0, 40),
    });
    return row;
  });
}

/** Asks the lender for its decision on a submitted proposal and records it (once). */
export async function collectDecision(deps: LendingDeps, proposalId: string): Promise<Proposal> {
  const now = deps.now ?? new Date();
  const db = deps.db;
  const [proposal] = await db.select().from(creditProposals).where(eq(creditProposals.id, proposalId));
  if (!proposal || proposal.status !== "submitted" || !proposal.lenderReference) return proposal!;
  const lender = await lenderForProposal(deps, proposal);
  if (!lender || decisionDeliveryOf(lender) === "push") return proposal; // partner-API lenders post decisions to us
  let decision;
  try {
    decision = await lender.getDecision(
      proposal.lenderReference,
      await creditProposalFor(db, proposal, lender, proposal.policyVersion),
    );
  } catch {
    return proposal; // try again on the next sweep
  }
  if (decision.outcome === "pending") return proposal;
  return db.transaction(async (tx) => {
    await tx
      .insert(lenderDecisions)
      .values({
        proposalId: proposal.id,
        lenderReference: decision.lenderReference,
        outcome: decision.outcome as DecisionOutcome,
        approvedExposure: decision.outcome === "declined" ? null : decision.approvedExposure,
        approvedTenorMonths: decision.outcome === "declined" ? null : decision.approvedTenorMonths,
        decisionBasis: decision.decisionBasis,
        policyVersion: decision.policyVersion,
        reasonCodes: decision.decisionReasonCodes.slice(0, 20),
        decidedAt: decision.decidedAt ?? now,
        receivedAt: now,
        ...storableOffer(decision.outcome, decision.offer),
      })
      .onConflictDoNothing();
    const [row] = await tx
      .update(creditProposals)
      .set({ status: "decided" })
      .where(and(eq(creditProposals.id, proposal.id), eq(creditProposals.status, "submitted")))
      .returning();
    if (row)
      await audit(tx, { type: "system" }, proposal.id, "lending.decision_received", { outcome: decision.outcome });
    return row ?? proposal;
  });
}

// ---------------------------------------------------------------------------
// Staff actions (risk console)
// ---------------------------------------------------------------------------

/** A risk admin releases a proposal held for fraud review; it's sent at once. */
export async function releaseHeldProposal(
  deps: LendingDeps,
  input: { staffId: string; proposalId: string; reason: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500)
    throw new LendingError("invalid", "Give a short reason (3–500 characters).");
  const now = deps.now ?? new Date();
  const released = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(creditProposals)
      .set({ status: "queued", releasedBy: input.staffId, releasedAt: now, releaseReason: reason, nextAttemptAt: null })
      .where(and(eq(creditProposals.id, input.proposalId), eq(creditProposals.status, "held")))
      .returning();
    if (!row) throw new LendingError("wrong_state", "Only a held proposal can be released.");
    await audit(tx, { type: "user", id: input.staffId }, row.id, "lending.proposal_released");
    return row;
  });
  return sendProposal(deps, released.id);
}

/** Puts a failed proposal back in the queue. */
export async function retryProposal(deps: LendingDeps, input: { staffId: string; proposalId: string }) {
  const row = await deps.db.transaction(async (tx) => {
    const [p] = await tx.select().from(creditProposals).where(eq(creditProposals.id, input.proposalId)).for("update");
    if (!p || p.status !== "failed") throw new LendingError("wrong_state", "Only a failed proposal can be retried.");
    const [live] = await tx
      .select({ id: creditProposals.id })
      .from(creditProposals)
      .where(
        and(
          eq(creditProposals.underwritingRunId, p.underwritingRunId),
          notInArray(creditProposals.status, [...LIVE_EXCLUDED]),
          sql`${creditProposals.id} <> ${p.id}`,
        ),
      )
      .limit(1);
    if (live) throw new LendingError("wrong_state", "Another proposal for this check is already in progress.");
    const [updated] = await tx
      .update(creditProposals)
      .set({ status: "queued", attempts: 0, nextAttemptAt: null, lastError: null })
      .where(eq(creditProposals.id, p.id))
      .returning();
    await audit(tx, { type: "user", id: input.staffId }, p.id, "lending.proposal_requeued");
    return updated!;
  });
  return sendProposal(deps, row.id);
}

export interface ReviewInput {
  staffId: string;
  proposalId: string;
  /** The decision revision the reviewer looked at: a newer revision since then is refused. */
  decisionId: string;
  action: "confirm" | "override";
  outcome?: DecisionOutcome;
  exposure?: number | null;
  tenorMonths?: number | null;
  reason?: string | null;
  now?: Date;
}

/** A proposal's decisions, newest revision first. */
async function decisionsOf(db: DbExecutor, proposalId: string, lock = false) {
  const q = db
    .select()
    .from(lenderDecisions)
    .where(eq(lenderDecisions.proposalId, proposalId))
    .orderBy(desc(lenderDecisions.revision));
  return lock ? q.for("update") : q;
}

async function openQueryOf(db: DbExecutor, proposalId: string) {
  const [q] = await db
    .select()
    .from(decisionQueries)
    .where(and(eq(decisionQueries.proposalId, proposalId), isNull(decisionQueries.resolvedAt)))
    .limit(1);
  return q ?? null;
}

const staleRevision = () =>
  new LendingError("wrong_state", "The partner sent a newer revision since you opened this page. Review it first.");

/** The partner serving a lender config, if it's an active partner on the partner API. */
async function activePartnerFor(db: DbExecutor, lenderKey: string) {
  const [p] = await db
    .select({ id: partners.id, status: partners.status })
    .from(partners)
    .where(eq(partners.lenderKey, lenderKey))
    .limit(1);
  return p && p.status === "active" ? p : null;
}

/** The pilot's simulated lender (its proposals carry the simulated policy version). */
const isSimulated = (p: Proposal) => p.policyVersion !== null;

/**
 * A risk admin reviews the lender's latest decision before the creator sees
 * it. Simulated lender: confirm, or override with a reason (never more
 * favourable). Partner lender (Stage 12b user decision): confirm only — to
 * question a partner's decision, raise a query (`raiseDecisionQuery`).
 */
export async function reviewDecision(db: Database, input: ReviewInput) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(creditProposals)
      .where(eq(creditProposals.id, input.proposalId))
      .for("update");
    if (!proposal) throw new LendingError("not_found");
    const [decision] = await decisionsOf(tx, proposal.id, true);
    if (!decision) throw new LendingError("wrong_state", "The lender hasn't decided yet.");
    if (decision.id !== input.decisionId) throw staleRevision();
    const [existing] = await tx
      .select({ id: decisionReviews.id })
      .from(decisionReviews)
      .where(eq(decisionReviews.proposalId, proposal.id));
    if (existing) throw new LendingError("wrong_state", "This decision has already been reviewed.");
    if (await openQueryOf(tx, proposal.id))
      throw new LendingError("wrong_state", "A query to the partner lender is open — wait for its answer.");

    let final: { outcome: DecisionOutcome; exposure: number | null; tenor: number | null; reason: string | null };
    const lenderTerms = termsOf(decision.offerTerms);
    if (input.action === "confirm") {
      final = {
        outcome: decision.outcome,
        exposure: decision.approvedExposure,
        tenor: decision.approvedTenorMonths,
        reason: input.reason?.trim() || null,
      };
    } else {
      if (!isSimulated(proposal))
        throw new LendingError(
          "invalid",
          "A partner lender's decision can't be changed by CreatorCo. Confirm it, or raise a query with the partner.",
        );
      const reason = input.reason?.trim() ?? "";
      if (reason.length < 10 || reason.length > 500)
        throw new LendingError("invalid", "Explain the override (10–500 characters).");
      if (!input.outcome) throw new LendingError("invalid", "Choose the final outcome.");
      const declined = input.outcome === "declined";
      const exposure = declined ? null : (input.exposure ?? null);
      const tenor = declined ? null : (input.tenorMonths ?? null);
      if (!declined && (exposure === null || exposure < 10_000 || exposure > 25_00_000))
        throw new LendingError("invalid", "Enter an amount between ₹10,000 and ₹25,00,000.");
      if (!declined && (tenor === null || tenor < 3 || tenor > 60))
        throw new LendingError("invalid", "Enter a tenor between 3 and 60 months.");
      // CreatorCo isn't the lender: an override can only be as favourable as the lender's decision, or less.
      if (
        OUTCOME_RANK[input.outcome] > OUTCOME_RANK[decision.outcome] ||
        (exposure !== null && (decision.approvedExposure === null || exposure > decision.approvedExposure)) ||
        (tenor !== null && decision.approvedTenorMonths !== null && tenor > decision.approvedTenorMonths)
      ) {
        throw new LendingError(
          "invalid",
          "An override can't be more favourable than the lender's decision — that is the partner lender's call.",
        );
      }
      final = { outcome: input.outcome, exposure, tenor, reason };
    }
    // The offer the creator sees: the lender's terms as given, or — for a simulated override — the same
    // illustrative pricing for the reduced amount/tenor.
    const finalTerms =
      final.outcome === "declined" || !lenderTerms || final.exposure === null || final.tenor === null
        ? null
        : input.action === "confirm"
          ? lenderTerms
          : repriceIllustrative(lenderTerms, final.exposure, final.tenor);
    // How long the creator has. A partner's expiry is the partner's: an offer that has already lapsed can't be
    // confirmed (query the partner for a fresh one). The simulated lender's validity starts when CreatorCo has
    // reviewed it, so fraud holds or a slow queue don't eat into the creator's window.
    const reviewedAt = input.now ?? new Date();
    let finalExpiresAt: Date | null = null;
    if (finalTerms && decision.offerExpiresAt) {
      if (isSimulated(proposal)) {
        const validity = decision.offerExpiresAt.getTime() - decision.decidedAt.getTime();
        finalExpiresAt = new Date(reviewedAt.getTime() + Math.max(validity, 86_400_000));
      } else if (decision.offerExpiresAt.getTime() <= reviewedAt.getTime()) {
        throw new LendingError(
          "wrong_state",
          "The partner's offer has expired. Raise a query so the partner can send a fresh decision.",
        );
      } else {
        finalExpiresAt = decision.offerExpiresAt;
      }
    }
    const [review] = await tx
      .insert(decisionReviews)
      .values({
        decisionId: decision.id,
        proposalId: proposal.id,
        reviewerId: input.staffId,
        action: input.action,
        finalOutcome: final.outcome,
        finalExposure: final.exposure,
        finalTenorMonths: final.tenor,
        reason: final.reason,
        finalOfferTerms: finalExpiresAt ? (finalTerms as unknown as Record<string, unknown>) : null,
        finalOfferExpiresAt: finalExpiresAt,
      })
      .returning();
    await audit(tx, { type: "user", id: input.staffId }, proposal.id, `lending.decision_${input.action}ed`, {
      outcome: final.outcome,
      changed: input.action === "override",
      revision: decision.revision,
    });
    if (input.action === "confirm")
      await recordPartnerEvent(tx, { lenderKey: proposal.lender, type: "decision.confirmed", proposalId: proposal.id });
    if (finalExpiresAt) {
      // The creator now sees an offer (funnel measurement only — no terms or amounts).
      const [app] = await tx
        .select({ userId: creditApplications.userId })
        .from(creditApplications)
        .where(eq(creditApplications.id, proposal.applicationId));
      if (app)
        await recordEvent(tx, {
          event: "offer_generated",
          userId: app.userId,
          props: { simulated: isSimulated(proposal) },
          now: reviewedAt,
        });
    }
    return review!;
  });
}

/**
 * Stage 12b: a risk admin questions a partner lender's decision instead of
 * changing it. The message goes to the partner (read through the partner
 * API, announced by a `decision.queried` webhook); the partner answers with a
 * new decision revision. The creator keeps seeing "with a partner lender".
 */
export async function raiseDecisionQuery(
  db: Database,
  input: { staffId: string; proposalId: string; decisionId: string; message: string },
) {
  const message = input.message.trim();
  if (message.length < QUERY_MESSAGE_MIN || message.length > QUERY_MESSAGE_MAX)
    throw new LendingError(
      "invalid",
      `Write the query for the partner (${QUERY_MESSAGE_MIN}–${QUERY_MESSAGE_MAX} characters).`,
    );
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(creditProposals)
      .where(eq(creditProposals.id, input.proposalId))
      .for("update");
    if (!proposal) throw new LendingError("not_found");
    if (isSimulated(proposal))
      throw new LendingError("invalid", "The simulated lender can't answer queries — confirm or override instead.");
    const [decision] = await decisionsOf(tx, proposal.id, true);
    if (!decision || proposal.status !== "decided")
      throw new LendingError("wrong_state", "The partner hasn't decided yet.");
    if (decision.id !== input.decisionId) throw staleRevision();
    if (!(await activePartnerFor(tx, proposal.lender)))
      throw new LendingError(
        "wrong_state",
        "This lender isn't an active partner on the partner API, so it can't answer a query. Confirm the decision instead.",
      );
    const [reviewed] = await tx
      .select({ id: decisionReviews.id })
      .from(decisionReviews)
      .where(eq(decisionReviews.proposalId, proposal.id));
    if (reviewed) throw new LendingError("wrong_state", "This decision has already been confirmed.");
    if (await openQueryOf(tx, proposal.id)) throw new LendingError("wrong_state", "A query is already open.");
    const [query] = await tx
      .insert(decisionQueries)
      .values({ proposalId: proposal.id, decisionId: decision.id, raisedBy: input.staffId, message })
      .returning();
    await audit(tx, { type: "user", id: input.staffId }, proposal.id, "lending.decision_queried", {
      revision: decision.revision,
    });
    await recordPartnerEvent(tx, {
      lenderKey: proposal.lender,
      type: "decision.queried",
      proposalId: proposal.id,
      queryId: query!.id,
    });
    return query!;
  });
}

/**
 * Closes an unanswered query (the partner is unresponsive or suspended), with
 * a reason. The decision stands as posted and can then be confirmed; the
 * partner is told (`decision.query_withdrawn`).
 */
export async function withdrawDecisionQuery(
  db: Database,
  input: { staffId: string; proposalId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (reason.length < QUERY_MESSAGE_MIN || reason.length > QUERY_MESSAGE_MAX)
    throw new LendingError(
      "invalid",
      `Say why the query is withdrawn (${QUERY_MESSAGE_MIN}–${QUERY_MESSAGE_MAX} characters).`,
    );
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(creditProposals)
      .where(eq(creditProposals.id, input.proposalId))
      .for("update");
    if (!proposal) throw new LendingError("not_found");
    const query = await openQueryOf(tx, proposal.id);
    if (!query) throw new LendingError("wrong_state", "There is no open query.");
    const [row] = await tx
      .update(decisionQueries)
      .set({ withdrawnBy: input.staffId, withdrawnReason: reason, resolvedAt: now })
      .where(and(eq(decisionQueries.id, query.id), isNull(decisionQueries.resolvedAt)))
      .returning();
    await audit(tx, { type: "user", id: input.staffId }, proposal.id, "lending.decision_query_withdrawn");
    await recordPartnerEvent(tx, {
      lenderKey: proposal.lender,
      type: "decision.query_withdrawn",
      proposalId: proposal.id,
      queryId: query.id,
    });
    return row!;
  });
}

export interface PartnerDecisionInput {
  outcome: DecisionOutcome;
  approvedExposure: number | null;
  approvedTenorMonths: number | null;
  decisionBasis: "traditional" | "creator_enhanced" | null;
  reasonCodes: string[];
  decidedAt: Date | null;
  lenderReference: string | null;
  /** Stage 13: required unless declined (validated by `partnerDecisionSchema`). */
  offer: Offer | null;
}

/**
 * A partner lender posts its decision through the partner API (Stage 12b).
 * The first decision on a submitted proposal is revision 1; a later revision
 * is accepted only in answer to an open CreatorCo query (and resolves it).
 * Idempotent per Idempotency-Key: the same key and body return the recorded
 * decision; the same key with a different body is a conflict.
 */
export async function recordPartnerDecision(
  db: Database,
  input: {
    lenderKey: string;
    apiKey: { id: string; prefix: string };
    proposalId: string;
    idempotencyKey: string;
    requestHash: string;
    decision: PartnerDecisionInput;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const d = input.decision;
  if (d.decidedAt && d.decidedAt.getTime() > now.getTime() + 5 * 60_000)
    throw new LendingError("invalid", "decidedAt can't be in the future.");
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(creditProposals)
      .where(and(eq(creditProposals.id, input.proposalId), eq(creditProposals.lender, input.lenderKey)))
      .for("update");
    // Never a simulated-lender proposal, whatever the lender key says.
    if (!proposal || isSimulated(proposal) || (proposal.status !== "submitted" && proposal.status !== "decided"))
      throw new LendingError("not_found");
    if (d.decidedAt && proposal.submittedAt && d.decidedAt.getTime() < proposal.submittedAt.getTime() - 60_000)
      throw new LendingError("invalid", "decidedAt can't be before the proposal was sent.");
    const [replay] = await tx
      .select()
      .from(lenderDecisions)
      .where(
        and(eq(lenderDecisions.proposalId, proposal.id), eq(lenderDecisions.idempotencyKey, input.idempotencyKey)),
      );
    if (replay) {
      if (replay.requestHash !== input.requestHash)
        throw new LendingError("conflict", "This Idempotency-Key was already used with a different request.");
      return { decision: replay, replayed: true };
    }
    if (d.outcome !== "declined") {
      if (!d.offer || d.offer.expiresAt.getTime() <= now.getTime())
        throw new LendingError("invalid", "An offer that hasn't expired is required unless the decision is a decline.");
      if (d.offer.expiresAt.getTime() > now.getTime() + MAX_OFFER_VALIDITY_DAYS * 86_400_000)
        throw new LendingError("invalid", `An offer can stand for at most ${MAX_OFFER_VALIDITY_DAYS} days.`);
      const partner = await activePartnerFor(tx, input.lenderKey);
      const [named] = partner
        ? await tx.select({ name: partners.name }).from(partners).where(eq(partners.id, partner.id))
        : [];
      if (!named || named.name !== d.offer.terms.lenderName)
        throw new LendingError("invalid", "offer.terms.lenderName must be the partner's registered name.");
    }
    const decisions = await decisionsOf(tx, proposal.id, true);
    const query = proposal.status === "decided" ? await openQueryOf(tx, proposal.id) : null;
    if (proposal.status === "decided" && !query)
      throw new LendingError(
        "wrong_state",
        "This proposal is already decided. A revision is accepted only in answer to a query.",
      );
    const declined = d.outcome === "declined";
    const [row] = await tx
      .insert(lenderDecisions)
      .values({
        proposalId: proposal.id,
        lenderReference: d.lenderReference ?? proposal.lenderReference!,
        outcome: d.outcome,
        approvedExposure: declined ? null : d.approvedExposure,
        approvedTenorMonths: declined ? null : d.approvedTenorMonths,
        decisionBasis: d.decisionBasis,
        policyVersion: null,
        reasonCodes: d.reasonCodes.slice(0, 20),
        decidedAt: d.decidedAt ?? now,
        receivedAt: now,
        revision: (decisions[0]?.revision ?? 0) + 1,
        source: "partner_api",
        ...storableOffer(d.outcome, d.offer),
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        apiKeyPrefix: input.apiKey.prefix,
      })
      .returning();
    if (proposal.status === "submitted") {
      await tx.update(creditProposals).set({ status: "decided" }).where(eq(creditProposals.id, proposal.id));
    }
    if (query) {
      await tx
        .update(decisionQueries)
        .set({ resolvedDecisionId: row!.id, resolvedAt: now })
        .where(eq(decisionQueries.id, query.id));
    }
    await recordAuditEvent(tx, {
      actorType: "partner",
      actorId: input.apiKey.id,
      eventType: "lending.decision_received",
      entityType: "credit_proposal",
      entityId: proposal.id,
      metadata: { outcome: d.outcome, revision: row!.revision, source: "partner_api" },
    });
    return { decision: row!, replayed: false };
  });
}

// ---------------------------------------------------------------------------
// Withdrawal, sweeps
// ---------------------------------------------------------------------------

async function withdrawUnsent(
  tx: DbExecutor,
  input: { applicationId?: string; userId?: string; reason: WithdrawReason; exceptRunId?: string },
) {
  const appIds = input.applicationId
    ? [input.applicationId]
    : (
        await tx
          .select({ id: creditApplications.id })
          .from(creditApplications)
          .where(eq(creditApplications.userId, input.userId!))
      ).map((a) => a.id);
  if (!appIds.length) return 0;
  const rows = await tx
    .update(creditProposals)
    .set({ status: "withdrawn", withdrawnReason: input.reason, nextAttemptAt: null })
    .where(
      and(
        inArray(creditProposals.applicationId, appIds),
        inArray(creditProposals.status, [...UNSENT_PROPOSAL_STATUSES]),
        input.exceptRunId ? sql`${creditProposals.underwritingRunId} <> ${input.exceptRunId}` : undefined,
      ),
    )
    .returning({ id: creditProposals.id });
  for (const r of rows)
    await audit(tx, { type: "system" }, r.id, "lending.proposal_withdrawn", { reason: input.reason });
  return rows.length;
}

/** The "Share with a partner lender" consent was withdrawn: cancel everything not yet sent. */
export async function withdrawUnsentProposals(tx: DbExecutor, input: { userId: string }) {
  return withdrawUnsent(tx, { userId: input.userId, reason: "consent_withdrawn" });
}

/**
 * Scheduled sweep: send due proposals, collect pending decisions, and prepare
 * proposals for confirmed checks whose creators shared through the API.
 */
export async function processLenderProposals(deps: LendingDeps, limit = 50) {
  const now = deps.now ?? new Date();
  const db = deps.db;
  let errors = 0;
  const safely = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (error) {
      errors += 1;
      void error; // counted; the job keeps going (details stay out of logs — they may carry payload values)
      return null;
    }
  };

  // 1. Sends interrupted mid-flight (process died): a failed attempt.
  const interrupted = await db
    .select()
    .from(creditProposals)
    .where(
      and(
        eq(creditProposals.status, "sending"),
        lte(creditProposals.updatedAt, new Date(now.getTime() - SENDING_LEASE_MS)),
      ),
    )
    .limit(limit);
  for (const p of interrupted) await safely(() => recordSendFailure(db, p, "interrupted", now));

  // 2. Due sends.
  const due = await db
    .select({ id: creditProposals.id })
    .from(creditProposals)
    .where(
      and(
        eq(creditProposals.status, "queued"),
        or(isNull(creditProposals.nextAttemptAt), lte(creditProposals.nextAttemptAt, now)),
      ),
    )
    .orderBy(asc(creditProposals.createdAt))
    .limit(limit);
  let sent = 0;
  for (const p of due) {
    const r = await safely(() => sendProposal(deps, p.id));
    if (r && (r.status === "submitted" || r.status === "decided")) sent += 1;
  }

  // 3. Pending decisions.
  const waiting = await db
    .select({ id: creditProposals.id })
    .from(creditProposals)
    .where(and(eq(creditProposals.status, "submitted"), isNotNull(creditProposals.lenderReference)))
    .limit(limit);
  let decided = 0;
  for (const p of waiting) if ((await safely(() => collectDecision(deps, p.id)))?.status === "decided") decided += 1;

  // 4. Confirmed checks of creators who hold the current sharing consent, with a recommendation for the
  //    confirmed inputs but no proposal for it yet — and not already blocked for consent scope.
  const confirmed = await db
    .select({ id: creditApplications.id, userId: creditApplications.userId })
    .from(creditApplications)
    .where(
      and(
        eq(creditApplications.status, "inputs_ready"),
        isNotNull(creditApplications.financialRunId),
        sql`exists (
          select 1 from public.consent_receipts r
          join public.consent_definitions d on d.id = r.consent_definition_id
          where r.user_id = ${creditApplications.userId} and r.status = 'granted' and d.key = 'lender_sharing'
            and d.active_from <= ${now.toISOString()}::timestamptz
            and (d.active_to is null or d.active_to > ${now.toISOString()}::timestamptz))`,
        sql`exists (
          select 1 from fin.underwriting_runs u
          where u.application_id = ${creditApplications.id} and u.financial_run_id = ${creditApplications.financialRunId})`,
        sql`not exists (
          select 1 from fin.credit_proposals p
          join fin.underwriting_runs u on u.id = p.underwriting_run_id
          where p.application_id = ${creditApplications.id} and p.status <> 'withdrawn'
            and u.financial_run_id = ${creditApplications.financialRunId})`,
        sql`not exists (
          select 1 from public.audit_events e
          where e.entity_id = ${creditApplications.id} and e.event_type = 'lending.proposal_blocked'
            and e.created_at >= ${creditApplications.inputsReadyAt})`,
      ),
    )
    .orderBy(asc(creditApplications.inputsReadyAt))
    .limit(limit);
  let prepared = 0;
  for (const a of confirmed) {
    if (await safely(() => proposeIfShared({ ...deps, now }, { userId: a.userId, applicationId: a.id }))) prepared += 1;
  }
  return { interrupted: interrupted.length, sent, decided, prepared, errors };
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export type CreatorLenderView =
  | { stage: "not_shared" }
  /** A check sent to a lender whose lender records were erased after the relationship closed (Stage 13). */
  | { stage: "closed" }
  | { stage: "preparing" }
  | { stage: "with_lender" }
  | {
      stage: "decided";
      outcome: DecisionOutcome;
      amount: number | null;
      tenorMonths: number | null;
      /** True for the pilot's simulated lender. */
      simulated: boolean;
      /** CreatorCo adjusted the lender's decision after review (never more favourably). */
      adjusted: boolean;
      decidedAt: Date;
      /** Stage 13: the offer and the creator's answer (null for a decline or a decision without terms). */
      offer: CreatorOffer | null;
    };

export interface CreatorOffer {
  state: OfferState;
  terms: OfferTerms;
  expiresAt: Date;
  /** Echoed back on acceptance: proves which terms the creator saw. */
  termsHash: string;
  respondedAt: Date | null;
  declineReason: OfferDeclineReason | null;
}

/**
 * What the creator sees about a check's journey to a partner lender. Fraud
 * holds look like any other preparation; decisions appear only once a
 * CreatorCo reviewer has confirmed or overridden them.
 */
export async function getCreatorLenderView(
  db: DbExecutor,
  input: { userId: string; applicationId: string; now?: Date },
): Promise<CreatorLenderView> {
  const [proposal] = await db
    .select({ p: creditProposals })
    .from(creditProposals)
    .innerJoin(creditApplications, eq(creditApplications.id, creditProposals.applicationId))
    .where(
      and(
        eq(creditProposals.applicationId, input.applicationId),
        eq(creditApplications.userId, input.userId),
        sql`${creditProposals.status} <> 'withdrawn'`,
      ),
    )
    .orderBy(desc(creditProposals.createdAt))
    .limit(1);
  if (!proposal) {
    const [app] = await db
      .select({ status: creditApplications.status })
      .from(creditApplications)
      .where(and(eq(creditApplications.id, input.applicationId), eq(creditApplications.userId, input.userId)));
    if (app?.status === "submitted") return { stage: "closed" };
    const shared = await sharingConsent(db, input.userId, input.now ?? new Date());
    return shared ? { stage: "preparing" } : { stage: "not_shared" };
  }
  const p = proposal.p;
  if (p.status === "held" || p.status === "queued" || p.status === "failed") return { stage: "preparing" };
  if (p.status === "sending") return { stage: "with_lender" };
  const [review] = await db.select().from(decisionReviews).where(eq(decisionReviews.proposalId, p.id)).limit(1);
  if (!review) return { stage: "with_lender" };
  const terms = termsOf(review.finalOfferTerms);
  let offer: CreatorOffer | null = null;
  if (terms && review.finalOfferExpiresAt) {
    const [response] = await db.select().from(offerResponses).where(eq(offerResponses.proposalId, p.id)).limit(1);
    const now = input.now ?? new Date();
    offer = {
      state: response ? response.response : review.finalOfferExpiresAt.getTime() <= now.getTime() ? "expired" : "open",
      terms,
      expiresAt: review.finalOfferExpiresAt,
      termsHash: termsHashOf(terms),
      respondedAt: response?.respondedAt ?? null,
      declineReason: response?.declineReason ?? null,
    };
  }
  return {
    stage: "decided",
    outcome: review.finalOutcome,
    amount: review.finalExposure,
    tenorMonths: review.finalTenorMonths,
    simulated: p.policyVersion !== null,
    adjusted: review.action === "override",
    decidedAt: review.createdAt,
    offer,
  };
}

export async function hasSharingConsent(db: DbExecutor, userId: string, now = new Date()) {
  return (await sharingConsent(db, userId, now)) !== null;
}

const PROPOSAL_ID = sql.raw(`"fin"."credit_proposals"."id"`); // qualified: see partner-views.ts

/** Proposals for the risk console, newest first (with the latest decision revision). */
export async function listProposals(db: DbExecutor, limit = 50) {
  const rows = await db
    .select({
      id: creditProposals.id,
      applicationId: creditProposals.applicationId,
      status: creditProposals.status,
      holdReason: creditProposals.holdReason,
      lender: creditProposals.lender,
      attempts: creditProposals.attempts,
      lastError: creditProposals.lastError,
      createdAt: creditProposals.createdAt,
      submittedAt: creditProposals.submittedAt,
      decisionOutcome: sql<DecisionOutcome | null>`(select d.outcome from fin.lender_decisions d
        where d.proposal_id = ${PROPOSAL_ID} order by d.revision desc limit 1)`,
      decisionRevision: sql<number | null>`(select max(d.revision) from fin.lender_decisions d
        where d.proposal_id = ${PROPOSAL_ID})`,
      openQuery: sql<boolean>`exists (select 1 from fin.decision_queries q
        where q.proposal_id = ${PROPOSAL_ID} and q.resolved_at is null)`,
      reviewAction: decisionReviews.action,
      finalOutcome: decisionReviews.finalOutcome,
    })
    .from(creditProposals)
    .leftJoin(decisionReviews, eq(decisionReviews.proposalId, creditProposals.id))
    .orderBy(desc(creditProposals.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    queue:
      r.status === "held"
        ? ("needs_release" as const)
        : r.status === "decided" && r.openQuery
          ? ("queried" as const)
          : r.status === "decided" && !r.reviewAction
            ? ("needs_review" as const)
            : r.status === "failed"
              ? ("failed" as const)
              : r.reviewAction
                ? ("reviewed" as const)
                : r.status === "withdrawn"
                  ? ("withdrawn" as const)
                  : ("in_progress" as const),
  }));
}

/** One proposal with what was sent, every decision revision, queries to the partner, and the review. */
export async function getProposalDetail(db: DbExecutor, proposalId: string) {
  const [p] = await db.select().from(creditProposals).where(eq(creditProposals.id, proposalId)).limit(1);
  if (!p) return null;
  const decisions = await decisionsOf(db, p.id);
  const queries = await db
    .select({ query: decisionQueries, raisedBy: users.email })
    .from(decisionQueries)
    .innerJoin(users, eq(users.id, decisionQueries.raisedBy))
    .where(eq(decisionQueries.proposalId, p.id))
    .orderBy(asc(decisionQueries.createdAt));
  const [review] = await db
    .select({ review: decisionReviews, reviewer: users.email })
    .from(decisionReviews)
    .innerJoin(users, eq(users.id, decisionReviews.reviewerId))
    .where(eq(decisionReviews.proposalId, p.id))
    .limit(1);
  const [releasedBy] = p.releasedBy
    ? await db.select({ email: users.email }).from(users).where(eq(users.id, p.releasedBy))
    : [];
  const openQuery = queries.find((q) => q.query.resolvedAt === null)?.query ?? null;
  const [response] = await db.select().from(offerResponses).where(eq(offerResponses.proposalId, p.id)).limit(1);
  return {
    proposal: { ...p, payload: p.payload as unknown as ProposalPayload },
    simulated: isSimulated(p),
    /** The latest revision (what a review acts on). */
    decision: decisions[0] ?? null,
    decisions,
    queries: queries.map((q) => ({ ...q.query, raisedByEmail: q.raisedBy })),
    openQuery,
    reviewActions: !decisions[0] || review || openQuery ? [] : reviewActionsFor(isSimulated(p)),
    review: review ? { ...review.review, reviewerEmail: review.reviewer } : null,
    /** Stage 13: the offer the creator was shown, and their answer. */
    offer: review ? termsOf(review.review.finalOfferTerms) : null,
    offerExpiresAt: review?.review.finalOfferExpiresAt ?? null,
    offerResponse: response ?? null,
    releasedByEmail: releasedBy?.email ?? null,
  };
}

export async function lendingQueueCounts(db: DbExecutor) {
  const rows = await listProposals(db, 500);
  const counts = {
    needs_release: 0,
    needs_review: 0,
    queried: 0,
    failed: 0,
    in_progress: 0,
    reviewed: 0,
    withdrawn: 0,
  };
  for (const r of rows) counts[r.queue] += 1;
  return counts;
}
