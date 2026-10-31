import { and, count, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { isUniqueViolation } from "@/db/errors";
import { accessOpportunities, accessRequests, brands, consentReceipts, creatorProfiles } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { recordEvent } from "@/modules/analytics";
import { CONSENT_KEYS, findValidReceipt, grantConsent, hasValidConsent } from "@/modules/consent";
import type { ConsentSource } from "@/modules/consent/domain";
import { currentTier } from "@/modules/creator-status/status-service";
import { CREATOR_STATUS_LABELS, meetsTier } from "@/modules/creator-status/status";
import {
  earnPoints,
  holdPoints,
  lockPointsAccount,
  pointsBalance,
  releasePoints,
} from "@/modules/rewards/ledger-service";
import { formatPoints } from "@/modules/rewards/rules";

import type { AccessDeclineReason, AccessRequestStatus } from "./domain";
import { AccessError } from "./errors";
import type { AccessDecision } from "./schemas";

/**
 * Access requests (Stage 14, user decisions): a request holds the
 * opportunity's Creator Points; the partnerships desk approves (the hold
 * stands as the spend) or declines (points returned). Creators can cancel a
 * pending request; pending requests expire when the opportunity closes.
 *
 * Requests need the purpose-specific `brand_opportunities` consent, granted
 * inside the request transaction when the creator agrees to it on the request
 * screen (a failed request never leaves it granted). Preview: nothing is sent
 * to any brand.
 *
 * Lock order: creator profile (points) → opportunity → request.
 */

async function lockOpportunity(tx: DbExecutor, id: string, mode: "update" | "share") {
  const [o] = await tx.select().from(accessOpportunities).where(eq(accessOpportunities.id, id)).for(mode);
  return o ?? null;
}

async function approvedCount(tx: DbExecutor, opportunityId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(accessRequests)
    .where(and(eq(accessRequests.opportunityId, opportunityId), eq(accessRequests.status, "approved")));
  return Number(row?.n ?? 0);
}

export async function requestAccess(
  db: Database,
  input: {
    userId: string;
    opportunityId: string;
    note: string | null;
    /** The active `brand_opportunities` definition the creator agreed to on the request screen, if not yet granted. */
    consentDefinitionId?: string | null;
    source: ConsentSource;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const creator = await creatorForUser(tx, input.userId);
      const account = await lockPointsAccount(tx, creator);
      if (account.status !== "completed")
        throw new AccessError("profile_inactive", "Your membership is paused. Resume it to request access.");

      const o = await lockOpportunity(tx, input.opportunityId, "share");
      if (!o || o.status === "draft") throw new AccessError("not_found");
      if (o.status !== "live" || o.closesAt.getTime() <= now.getTime())
        throw new AccessError("closed", "Requests for this opportunity have closed.");
      if (o.opensAt.getTime() > now.getTime()) throw new AccessError("closed", "Requests haven't opened yet.");

      const tier = await currentTier(tx, account.id);
      if (!meetsTier(tier, o.minTier))
        throw new AccessError("tier_required", `This opportunity is for ${CREATOR_STATUS_LABELS[o.minTier]} members.`);

      const [active] = await tx
        .select({ id: accessRequests.id })
        .from(accessRequests)
        .where(
          and(
            eq(accessRequests.opportunityId, o.id),
            eq(accessRequests.creatorId, account.id),
            inArray(accessRequests.status, ["requested", "approved"]),
          ),
        );
      if (active) throw new AccessError("wrong_state", "You've already requested this.");
      if ((await approvedCount(tx, o.id)) >= o.seats) throw new AccessError("full", "Every place has been taken.");
      if ((await pointsBalance(tx, account.id)) < o.pointsCost)
        throw new AccessError("insufficient_points", `This needs ${formatPoints(o.pointsCost)}.`);

      // Consent: the creator's existing grant, or the one they agreed to on this screen.
      if (!(await hasValidConsent(tx, input.userId, CONSENT_KEYS.brandOpportunities, now))) {
        if (!input.consentDefinitionId)
          throw new AccessError("consent_required", "Agree to the brand opportunities consent to request access.");
        try {
          await grantConsent(tx, {
            userId: input.userId,
            key: CONSENT_KEYS.brandOpportunities,
            consentDefinitionId: input.consentDefinitionId,
            source: input.source,
            metadata: { surface: "access_request" },
            now,
          });
        } catch {
          throw new AccessError("consent_required", "The consent text has been updated. Reload and review it.");
        }
      }
      const receipt = await findValidReceipt(tx, input.userId, CONSENT_KEYS.brandOpportunities, now);
      if (!receipt) throw new AccessError("consent_required");
      // Hold the receipt — still granted — so a concurrent withdrawal can't slip between: a withdrawal
      // locks it first (we then see it withdrawn and stop), or waits for this request to commit and cancels it.
      const [held] = await tx
        .select({ id: consentReceipts.id })
        .from(consentReceipts)
        .where(and(eq(consentReceipts.id, receipt.id), eq(consentReceipts.status, "granted")))
        .for("share");
      if (!held) throw new AccessError("consent_required", "Your brand opportunities consent was withdrawn.");

      const [request] = await tx
        .insert(accessRequests)
        .values({
          opportunityId: o.id,
          userId: input.userId,
          creatorId: account.id,
          pointsHeld: o.pointsCost,
          tierAtRequest: tier,
          note: input.note,
          consentReceiptId: receipt.id,
          requestedAt: now,
        })
        .returning({ id: accessRequests.id });
      await holdPoints(tx, { creatorId: account.id, requestId: request!.id, amount: o.pointsCost, now });
      await recordEvent(tx, {
        event: "access_requested",
        userId: input.userId,
        props: { kind: o.kind, min_tier: o.minTier },
        now,
      });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.userId,
        eventType: "access.requested",
        entityType: "access_request",
        entityId: request!.id,
        // No opportunity id: the request (what was asked for) is erased on withdrawal; the audit row stays minimal.
        metadata: { points: o.pointsCost, tier },
      });
      return { requestId: request!.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "access_requests_active_key"))
      throw new AccessError("wrong_state", "You've already requested this.");
    throw error;
  }
}

async function creatorForUser(tx: DbExecutor, userId: string): Promise<string> {
  const [row] = await tx
    .select({ id: creatorProfiles.id })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId));
  if (!row) throw new AccessError("profile_inactive");
  return row.id;
}

/** Closes a pending request and returns its points. */
async function closePending(
  tx: DbExecutor,
  request: { id: string; creatorId: string },
  status: Exclude<AccessRequestStatus, "requested" | "approved">,
  now: Date,
  decision?: { staffUserId: string; reason: AccessDeclineReason },
) {
  await tx
    .update(accessRequests)
    .set({
      status,
      closedAt: now,
      ...(decision ? { decidedBy: decision.staffUserId, decidedAt: now, declineReason: decision.reason } : {}),
    })
    .where(and(eq(accessRequests.id, request.id), eq(accessRequests.status, "requested")));
  return releasePoints(tx, { creatorId: request.creatorId, requestId: request.id, now });
}

/** The creator cancels their own pending request. */
export async function cancelAccessRequest(db: Database, input: { userId: string; requestId: string; now?: Date }) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(accessRequests)
      .where(and(eq(accessRequests.id, input.requestId), eq(accessRequests.userId, input.userId)));
    if (!r) throw new AccessError("not_found");
    await lockOpportunity(tx, r.opportunityId, "share");
    const [locked] = await tx.select().from(accessRequests).where(eq(accessRequests.id, r.id)).for("update");
    if (locked?.status !== "requested") throw new AccessError("wrong_state", "This request can't be cancelled now.");
    const returned = await closePending(tx, locked, "cancelled", now);
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "access.cancelled",
      entityType: "access_request",
      entityId: r.id,
      metadata: { points_returned: returned },
    });
  });
}

/** The partnerships desk approves or declines a pending request. */
export async function decideAccessRequest(
  db: Database,
  input: { staffUserId: string; requestId: string; decision: AccessDecision; now?: Date },
) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(accessRequests).where(eq(accessRequests.id, input.requestId));
    if (!r) throw new AccessError("not_found");
    const o = await lockOpportunity(tx, r.opportunityId, "update");
    const [locked] = await tx.select().from(accessRequests).where(eq(accessRequests.id, r.id)).for("update");
    if (!o || locked?.status !== "requested")
      throw new AccessError("wrong_state", "This request has already been closed.");

    if (input.decision.decision === "decline") {
      const returned = await closePending(tx, locked, "declined", now, {
        staffUserId: input.staffUserId,
        reason: input.decision.reason,
      });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.staffUserId,
        eventType: "access.declined",
        entityType: "access_request",
        entityId: r.id,
        metadata: { reason: input.decision.reason, points_returned: returned },
      });
      return;
    }

    if (o.status !== "live") throw new AccessError("closed", "This opportunity is closed.");
    if ((await approvedCount(tx, o.id)) >= o.seats) throw new AccessError("full", "Every place has been taken.");
    // Read, not locked: approving doesn't change the balance (the hold stands as the spend).
    const [account] = await tx
      .select({ status: creatorProfiles.profileStatus })
      .from(creatorProfiles)
      .where(eq(creatorProfiles.id, locked.creatorId));
    if (account?.status !== "completed")
      throw new AccessError("profile_inactive", "This creator's membership is paused. Decline the request instead.");
    if (!(await hasValidConsent(tx, locked.userId, CONSENT_KEYS.brandOpportunities, now)))
      throw new AccessError("consent_required", "The creator has withdrawn the brand opportunities consent.");
    await tx
      .update(accessRequests)
      .set({ status: "approved", decidedBy: input.staffUserId, decidedAt: now, closedAt: now })
      .where(and(eq(accessRequests.id, r.id), eq(accessRequests.status, "requested")));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.approved",
      entityType: "access_request",
      entityId: r.id,
      metadata: { points_spent: locked.pointsHeld },
    });
  });
}

/**
 * The partnerships desk marks an approved request as completed (the creator
 * attended / delivered). Earns the `access_completed` points once per request —
 * the same whatever the opportunity cost. Idempotent.
 */
export async function completeAccessRequest(
  db: Database,
  input: { staffUserId: string; requestId: string; now?: Date },
): Promise<{ completed: boolean }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(accessRequests).where(eq(accessRequests.id, input.requestId)).for("update");
    if (!r) throw new AccessError("not_found");
    if (r.userId === input.staffUserId) throw new AccessError("wrong_state", "You can't complete your own request.");
    if (r.status !== "approved") throw new AccessError("wrong_state", "Only approved requests can be completed.");
    if (r.completedAt) return { completed: false };
    await tx
      .update(accessRequests)
      .set({ completedAt: now, completedBy: input.staffUserId })
      .where(and(eq(accessRequests.id, r.id), isNull(accessRequests.completedAt)));
    await earnPoints(tx, {
      creatorId: r.creatorId,
      rule: "access_completed",
      ref: r.id,
      requestId: r.id,
      now,
    });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.completed",
      entityType: "access_request",
      entityId: r.id,
    });
    return { completed: true };
  });
}

/** Expires an opportunity's pending requests (the caller holds the opportunity lock). */
export async function expireRequestsFor(tx: DbExecutor, input: { opportunityId: string; now: Date }) {
  const pending = await tx
    .select()
    .from(accessRequests)
    .where(and(eq(accessRequests.opportunityId, input.opportunityId), eq(accessRequests.status, "requested")))
    .for("update");
  for (const r of pending) await closePending(tx, r, "expired", input.now);
  return pending.length;
}

/**
 * Sweep (job `expire_access_requests`): opportunities whose window has ended
 * are closed and their pending requests expire with points returned.
 * Idempotent; one transaction per opportunity.
 */
export async function expireAccessRequests(deps: { db: Database; now?: Date }) {
  const now = deps.now ?? new Date();
  const lapsed = await deps.db
    .select({ id: accessOpportunities.id })
    .from(accessOpportunities)
    .where(
      or(
        and(eq(accessOpportunities.status, "live"), lte(accessOpportunities.closesAt, now)),
        // Closed opportunities with requests still pending (e.g. a close interrupted mid-way).
        inArray(
          accessOpportunities.id,
          deps.db
            .select({ id: accessRequests.opportunityId })
            .from(accessRequests)
            .innerJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
            .where(and(eq(accessRequests.status, "requested"), eq(accessOpportunities.status, "closed"))),
        ),
      ),
    );
  let expired = 0;
  for (const { id } of lapsed) {
    expired += await deps.db.transaction(async (tx) => {
      const o = await lockOpportunity(tx, id, "update");
      if (!o) return 0;
      if (o.status === "live" && o.closesAt.getTime() <= now.getTime())
        await tx.update(accessOpportunities).set({ status: "closed" }).where(eq(accessOpportunities.id, id));
      return expireRequestsFor(tx, { opportunityId: id, now });
    });
  }
  return { opportunities: lapsed.length, expired };
}

export interface CreatorRequestView {
  id: string;
  opportunityId: string;
  title: string;
  brandName: string;
  status: AccessRequestStatus;
  pointsHeld: number;
  requestedAt: Date;
  closedAt: Date | null;
  completedAt: Date | null;
  declineReason: AccessDeclineReason | null;
}

/** The creator's requests, newest first. */
export async function listRequestsForCreator(db: DbExecutor, userId: string): Promise<CreatorRequestView[]> {
  const rows = await db
    .select({ r: accessRequests, title: accessOpportunities.title, brandName: brands.name })
    .from(accessRequests)
    .innerJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
    .innerJoin(brands, eq(brands.id, accessOpportunities.brandId))
    .where(eq(accessRequests.userId, userId))
    .orderBy(desc(accessRequests.requestedAt));
  return rows.map(({ r, title, brandName }) => ({
    id: r.id,
    opportunityId: r.opportunityId,
    title,
    brandName,
    status: r.status,
    pointsHeld: r.pointsHeld,
    requestedAt: r.requestedAt,
    closedAt: r.closedAt,
    completedAt: r.completedAt,
    declineReason: r.declineReason,
  }));
}
