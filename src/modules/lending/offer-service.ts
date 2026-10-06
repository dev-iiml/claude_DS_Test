import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  consentReceipts,
  creatorProfiles,
  creditApplications,
  creditProposals,
  decisionReviews,
  offerResponses,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, grantConsent, hasValidConsent } from "@/modules/consent";
import type { ConsentSource } from "@/modules/consent/domain";
import { recordPartnerEvent } from "@/modules/partners";
import { offerTermsSchema } from "@/providers/lender/offer";

import { OFFER_DECLINE_REASONS, type OfferDeclineReason } from "./domain";
import { LendingError, termsHashOf } from "./proposal-service";

/**
 * The creator's answer to a reviewed offer (Stage 13, user decisions):
 *
 * - terms come from the partner lender (illustrative for the simulated one);
 *   the offer stands until the lender's `expiresAt`;
 * - **Accept** records the exact terms shown (hash), the KFS acknowledgement
 *   and the "Continue with the partner lender" consent receipt, then tells the
 *   partner (`offer.accepted`). KYC, the agreement, eSign and disbursal are the
 *   partner's;
 * - **Decline** is recorded and the partner is told. Declined and expired
 *   offers keep their data until the creator withdraws consent — and, unlike
 *   accepted ones, don't hold back that erasure (`lenderRetentionHold`).
 */

interface OfferContext {
  proposalId: string;
  lender: string;
  reviewId: string;
  terms: ReturnType<typeof offerTermsSchema.parse> | null;
  expiresAt: Date | null;
  finalOutcome: string;
}

/** Locks the check's live proposal and returns its reviewed offer. */
async function lockOffer(tx: DbExecutor, userId: string, applicationId: string): Promise<OfferContext> {
  const [app] = await tx
    .select({ id: creditApplications.id, status: creditApplications.status })
    .from(creditApplications)
    .where(and(eq(creditApplications.id, applicationId), eq(creditApplications.userId, userId)));
  if (!app) throw new LendingError("not_found");
  const [proposal] = await tx
    .select({ id: creditProposals.id, lender: creditProposals.lender })
    .from(creditProposals)
    .where(and(eq(creditProposals.applicationId, app.id), notInArray(creditProposals.status, ["withdrawn"])))
    .orderBy(desc(creditProposals.createdAt))
    .limit(1)
    .for("update");
  if (!proposal) throw new LendingError("wrong_state", "There's no offer on this check.");
  const [review] = await tx.select().from(decisionReviews).where(eq(decisionReviews.proposalId, proposal.id));
  if (!review) throw new LendingError("wrong_state", "There's no offer on this check yet.");
  const parsed = review.finalOfferTerms ? offerTermsSchema.safeParse(review.finalOfferTerms) : null;
  return {
    proposalId: proposal.id,
    lender: proposal.lender,
    reviewId: review.id,
    terms: parsed?.success ? parsed.data : null,
    expiresAt: review.finalOfferExpiresAt,
    finalOutcome: review.finalOutcome,
  };
}

async function assertAnswerable(tx: DbExecutor, offer: OfferContext, now: Date) {
  if (offer.finalOutcome === "declined" || !offer.terms || !offer.expiresAt)
    throw new LendingError("wrong_state", "There's no offer to answer on this check.");
  const [answered] = await tx
    .select({ id: offerResponses.id })
    .from(offerResponses)
    .where(eq(offerResponses.proposalId, offer.proposalId));
  if (answered) throw new LendingError("wrong_state", "You've already answered this offer.");
  if (offer.expiresAt.getTime() <= now.getTime())
    throw new LendingError("wrong_state", "This offer has expired. You can start a new check.");
}

/**
 * Accepts the reviewed offer. In one transaction, after every check passes:
 * gives the "Continue with the partner lender" consent shown on the offer
 * screen (so a failed acceptance never leaves it granted), records the exact
 * terms accepted, and tells the partner. Needs the financial-eligibility
 * consent and an active membership: withdrawing either stops processing.
 */
export async function acceptOffer(
  db: Database,
  input: {
    userId: string;
    applicationId: string;
    termsHash: string;
    kfsAcknowledged: boolean;
    /** The active `lender_handoff` definition the creator agreed to on the offer screen. */
    consentDefinitionId: string;
    source: ConsentSource;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (!input.kfsAcknowledged)
    throw new LendingError("invalid", "Confirm you've read the Key Fact Statement before accepting.");
  return db.transaction(async (tx) => {
    const offer = await lockOffer(tx, input.userId, input.applicationId);
    await assertAnswerable(tx, offer, now);
    // The creator agrees to exactly the terms on their screen.
    if (termsHashOf(offer.terms!) !== input.termsHash)
      throw new LendingError("conflict", "The offer changed since you opened it. Review it again.");
    const [profile] = await tx
      .select({ status: creatorProfiles.profileStatus })
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, input.userId));
    if (profile?.status !== "completed")
      throw new LendingError("wrong_state", "Your membership is paused. Resume it to answer this offer.");
    if (!(await hasValidConsent(tx, input.userId, CONSENT_KEYS.financialEligibility, now)))
      throw new LendingError(
        "consent_required",
        "Your financial-eligibility consent was withdrawn, so this offer can't be accepted.",
      );
    let receipt;
    try {
      receipt = await grantConsent(tx, {
        userId: input.userId,
        key: CONSENT_KEYS.lenderHandoff,
        consentDefinitionId: input.consentDefinitionId,
        source: input.source,
        metadata: { surface: "offer" },
        now,
      });
    } catch {
      throw new LendingError("consent_required", "The consent text has been updated. Reload and review it.");
    }
    // Hold the receipt while accepting, so a concurrent withdrawal can't slip between.
    await tx
      .select({ id: consentReceipts.id })
      .from(consentReceipts)
      .where(eq(consentReceipts.id, receipt.id))
      .for("share");
    const [row] = await tx
      .insert(offerResponses)
      .values({
        proposalId: offer.proposalId,
        reviewId: offer.reviewId,
        userId: input.userId,
        response: "accepted",
        termsHash: input.termsHash,
        kfsAcknowledged: true,
        handoffReceiptId: receipt.id,
        respondedAt: now,
      })
      .returning();
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "lending.offer_accepted",
      entityType: "credit_proposal",
      entityId: offer.proposalId,
      metadata: {},
    });
    await recordPartnerEvent(tx, { lenderKey: offer.lender, type: "offer.accepted", proposalId: offer.proposalId });
    return row!;
  });
}

export async function declineOffer(
  db: Database,
  input: { userId: string; applicationId: string; reason?: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  const reason = input.reason
    ? (OFFER_DECLINE_REASONS as readonly string[]).includes(input.reason)
      ? (input.reason as OfferDeclineReason)
      : null
    : null;
  return db.transaction(async (tx) => {
    const offer = await lockOffer(tx, input.userId, input.applicationId);
    await assertAnswerable(tx, offer, now);
    const [row] = await tx
      .insert(offerResponses)
      .values({
        proposalId: offer.proposalId,
        reviewId: offer.reviewId,
        userId: input.userId,
        response: "declined",
        termsHash: termsHashOf(offer.terms!),
        declineReason: reason,
        respondedAt: now,
      })
      .returning();
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "lending.offer_declined",
      entityType: "credit_proposal",
      entityId: offer.proposalId,
      metadata: reason ? { reason } : {},
    });
    await recordPartnerEvent(tx, { lenderKey: offer.lender, type: "offer.declined", proposalId: offer.proposalId });
    return row!;
  });
}

/**
 * Sent checks whose lender relationship has closed: the lender's decision was
 * a decline (after review), the creator declined the offer, or it expired
 * unanswered. Their data is kept until the creator withdraws consent, and
 * then erased — they don't hold erasure back (user decision, Stage 13).
 */
export async function closedLenderCheckIds(db: DbExecutor, userId: string, now = new Date()): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select a.id
      from fin.credit_applications a
      join lateral (
        select p.id from fin.credit_proposals p
         where p.application_id = a.id and p.status <> 'withdrawn'
         order by p.created_at desc limit 1) lp on true
      join fin.decision_reviews r on r.proposal_id = lp.id
      left join fin.offer_responses o on o.proposal_id = lp.id
     where a.user_id = ${userId}
       and a.status = 'submitted'
       and a.inputs_erased_at is null
       and (r.final_outcome = 'declined'
         or o.response = 'declined'
         or (o.id is null and r.final_offer_expires_at is not null
             and r.final_offer_expires_at <= ${now.toISOString()}::timestamptz))`);
  return [...rows].map((r) => r.id);
}

/**
 * Sent checks still held for the lender relationship: awaiting a decision or
 * its review, an open offer, an accepted one — and, conservatively, a check
 * marked sent without a live proposal or a legacy reviewed approval without
 * terms. Per check: a closed check is never held because another one is open.
 */
export async function heldLenderCheckIds(db: DbExecutor, userId: string, now = new Date()): Promise<string[]> {
  const sent = await db
    .select({ id: creditApplications.id })
    .from(creditApplications)
    .where(
      and(
        eq(creditApplications.userId, userId),
        eq(creditApplications.status, "submitted"),
        isNull(creditApplications.inputsErasedAt),
      ),
    );
  const closed = new Set(await closedLenderCheckIds(db, userId, now));
  return sent.map((a) => a.id).filter((id) => !closed.has(id));
}

/** True while any check is held for its lender relationship (drives the retention hold). */
export async function lenderRetentionHold(db: DbExecutor, userId: string, now = new Date()) {
  return (await heldLenderCheckIds(db, userId, now)).length > 0;
}
