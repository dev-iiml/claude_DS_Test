import { and, asc, count, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { isUniqueViolation } from "@/db/errors";
import {
  accessOpportunities,
  accessRequests,
  consentDefinitions,
  consentReceipts,
  creatorProfiles,
  creatorSocialAccounts,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, getActiveDefinition, grantConsent, type ConsentSource } from "@/modules/consent";
import { getCurrentCreatorStatus } from "@/modules/creator-status/status-service";
import type { CreatorStatusTier } from "@/modules/creator-status/status";
import { getLatestProfessionalGraph } from "@/modules/professional-graph/graph-service";
import { getPointsBalance, holdPoints, lockPointsAccount, releasePoints } from "@/modules/rewards/points-service";

import {
  isOpportunityOpen,
  requestEligibility,
  requestExpiresAt,
  type AccessRequestStatus,
  type CancelReason,
  type DeclineReason,
  type RequestRefusal,
} from "./domain";

/**
 * Access preview (Stage 14). Lock order, everywhere, to stay deadlock-free:
 *   consent receipt → access request row → points account (profile) → opportunity.
 * Requests hold points at once; approval spends them, anything else returns them.
 * Nothing in this module reads or writes financial data, and nothing leaves CreatorCo.
 */

export type Opportunity = typeof accessOpportunities.$inferSelect;
export type AccessRequest = typeof accessRequests.$inferSelect;

export class AccessError extends Error {
  constructor(
    readonly code: "not_found" | "not_pending" | "expired" | "full" | "places_below_approved" | "slug_taken",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AccessError";
  }
}

async function approvedCounts(db: DbExecutor, opportunityIds: string[]) {
  if (!opportunityIds.length) return new Map<string, number>();
  const rows = await db
    .select({ id: accessRequests.opportunityId, n: count() })
    .from(accessRequests)
    .where(and(inArray(accessRequests.opportunityId, opportunityIds), eq(accessRequests.status, "approved")))
    .groupBy(accessRequests.opportunityId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

// ---------------------------------------------------------------------------
// Creator side
// ---------------------------------------------------------------------------

export interface CreatorOpportunityView {
  opportunity: Opportunity;
  placesLeft: number;
  myRequest: Pick<AccessRequest, "id" | "status" | "pointsHeld" | "requestedAt" | "expiresAt" | "declineReason"> | null;
  /** Whether the creator could request it right now; `reason` explains why not. */
  canRequest: { ok: true } | { ok: false; reason: RequestRefusal };
}

async function creatorContext(db: DbExecutor, creatorId: string) {
  // Sequential: these may run on one transaction's connection.
  const status = await getCurrentCreatorStatus(db, creatorId);
  const balance = await getPointsBalance(db, creatorId);
  return { tier: status.tier, balance };
}

function viewFor(
  o: Opportunity,
  ctx: { tier: CreatorStatusTier; balance: number },
  approved: number,
  mine: AccessRequest | undefined,
  now: Date,
): CreatorOpportunityView {
  const active = mine && (mine.status === "requested" || mine.status === "approved");
  return {
    opportunity: o,
    placesLeft: Math.max(0, o.places - approved),
    myRequest: mine
      ? {
          id: mine.id,
          status: mine.status,
          pointsHeld: mine.pointsHeld,
          requestedAt: mine.requestedAt,
          expiresAt: mine.expiresAt,
          declineReason: mine.declineReason,
        }
      : null,
    canRequest: requestEligibility({
      opportunity: o,
      tier: ctx.tier,
      balance: ctx.balance,
      approvedCount: approved,
      hasActiveRequest: Boolean(active),
      now,
    }),
  };
}

/** Open opportunities (and ones the creator has requested), newest window first. Read-only. */
export async function listOpportunitiesForCreator(
  db: DbExecutor,
  input: { creatorId: string; now?: Date },
): Promise<CreatorOpportunityView[]> {
  const now = input.now ?? new Date();
  const mine = await db
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.creatorId, input.creatorId))
    .orderBy(desc(accessRequests.requestedAt));
  const requestedIds = [...new Set(mine.map((r) => r.opportunityId))];
  const opportunities = await db
    .select()
    .from(accessOpportunities)
    .where(
      or(
        and(eq(accessOpportunities.status, "open"), gt(accessOpportunities.closesAt, now)),
        requestedIds.length ? inArray(accessOpportunities.id, requestedIds) : sql`false`,
      ),
    )
    .orderBy(asc(accessOpportunities.closesAt), asc(accessOpportunities.title));
  const ctx = await creatorContext(db, input.creatorId);
  const approved = await approvedCounts(
    db,
    opportunities.map((o) => o.id),
  );
  return opportunities.map((o) =>
    viewFor(
      o,
      ctx,
      approved.get(o.id) ?? 0,
      mine.find((r) => r.opportunityId === o.id),
      now,
    ),
  );
}

export async function getOpportunityForCreator(
  db: DbExecutor,
  input: { creatorId: string; opportunityId: string; now?: Date },
): Promise<CreatorOpportunityView | null> {
  const now = input.now ?? new Date();
  const [o] = await db
    .select()
    .from(accessOpportunities)
    .where(eq(accessOpportunities.id, input.opportunityId))
    .limit(1);
  if (!o) return null;
  const [mine] = await db
    .select()
    .from(accessRequests)
    .where(and(eq(accessRequests.creatorId, input.creatorId), eq(accessRequests.opportunityId, o.id)))
    .orderBy(desc(accessRequests.requestedAt))
    .limit(1);
  // A closed opportunity the creator never requested isn't shown.
  if (!mine && !isOpportunityOpen(o, now) && o.opensAt <= now) return null;
  const ctx = await creatorContext(db, input.creatorId);
  const approved = await approvedCounts(db, [o.id]);
  return viewFor(o, ctx, approved.get(o.id) ?? 0, mine, now);
}

export type RequestAccessResult =
  | { ok: true; requestId: string; pointsHeld: number }
  | { ok: false; reason: RequestRefusal | "consent_required" | "profile_inactive" | "not_found" };

class RequestRefused extends Error {
  constructor(readonly reason: Exclude<RequestAccessResult, { ok: true }>["reason"]) {
    super(reason);
  }
}

/**
 * Requests an opportunity. The Brand opportunities consent is required: if
 * the creator doesn't hold the current version, they must have been shown it
 * (`consentDefinitionId`) and it is granted in this transaction. Points are
 * held in the same transaction. A refusal rolls everything back.
 */
export async function requestAccess(
  db: Database,
  input: {
    userId: string;
    opportunityId: string;
    note?: string | null;
    consentDefinitionId?: string | null;
    source: ConsentSource;
    now?: Date;
  },
): Promise<RequestAccessResult> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      // 1. Consent receipt — locked only while it is still granted (a concurrent withdrawal wins or waits).
      const active = await getActiveDefinition(tx, CONSENT_KEYS.brandOpportunities, now);
      if (!active) throw new RequestRefused("consent_required");
      const [held] = await tx
        .select({ id: consentReceipts.id })
        .from(consentReceipts)
        .where(
          and(
            eq(consentReceipts.userId, input.userId),
            eq(consentReceipts.consentDefinitionId, active.id),
            eq(consentReceipts.status, "granted"),
          ),
        )
        .for("update");
      let receiptId = held?.id;
      if (!receiptId) {
        if (input.consentDefinitionId !== active.id) throw new RequestRefused("consent_required");
        const granted = await grantConsent(tx, {
          userId: input.userId,
          key: CONSENT_KEYS.brandOpportunities,
          consentDefinitionId: active.id,
          source: input.source,
          metadata: { surface: "access_request" },
          now,
        });
        receiptId = granted.id;
      }

      // 2. Points account (the creator profile).
      const [profileRef] = await tx
        .select({ id: creatorProfiles.id })
        .from(creatorProfiles)
        .where(eq(creatorProfiles.userId, input.userId))
        .limit(1);
      if (!profileRef) throw new RequestRefused("profile_inactive");
      const profile = await lockPointsAccount(tx, profileRef.id);
      if (!profile || profile.status !== "completed") throw new RequestRefused("profile_inactive");

      // 3. Opportunity.
      const [o] = await tx
        .select()
        .from(accessOpportunities)
        .where(eq(accessOpportunities.id, input.opportunityId))
        .for("no key update");
      if (!o) throw new RequestRefused("not_found");

      const { tier, balance } = await creatorContext(tx, profile.id);
      const approved = await approvedCounts(tx, [o.id]);
      const existing = await tx
        .select({ id: accessRequests.id })
        .from(accessRequests)
        .where(
          and(
            eq(accessRequests.creatorId, profile.id),
            eq(accessRequests.opportunityId, o.id),
            inArray(accessRequests.status, ["requested", "approved"]),
          ),
        )
        .limit(1);
      const eligibility = requestEligibility({
        opportunity: o,
        tier,
        balance,
        approvedCount: approved.get(o.id) ?? 0,
        hasActiveRequest: existing.length > 0,
        now,
      });
      if (!eligibility.ok) throw new RequestRefused(eligibility.reason);

      const note = input.note?.trim() ? input.note.trim() : null;
      const [request] = await tx
        .insert(accessRequests)
        .values({
          opportunityId: o.id,
          creatorId: profile.id,
          userId: input.userId,
          note,
          pointsHeld: o.pointsCost,
          consentReceiptId: receiptId,
          requestedAt: now,
          expiresAt: requestExpiresAt(now, o.closesAt),
        })
        .returning({ id: accessRequests.id });
      await holdPoints(tx, { creatorId: profile.id, accessRequestId: request!.id, points: o.pointsCost });
      // Minimal audit record (disclosed in the consent): no opportunity, no note.
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.userId,
        eventType: "access.requested",
        entityType: "access_request",
        entityId: request!.id,
        metadata: { points: o.pointsCost },
      });
      return { ok: true as const, requestId: request!.id, pointsHeld: o.pointsCost };
    });
  } catch (error) {
    if (error instanceof RequestRefused) return { ok: false, reason: error.reason };
    if (isUniqueViolation(error, "access_requests_active_key")) return { ok: false, reason: "already_requested" };
    throw error;
  }
}

/** Ends a pending request (not by a staff decision) and returns its points. Caller holds the request row lock. */
async function endPending(
  tx: DbExecutor,
  request: Pick<AccessRequest, "id" | "creatorId">,
  outcome: { status: "cancelled"; reason: CancelReason } | { status: "expired" },
  now: Date,
) {
  await lockPointsAccount(tx, request.creatorId);
  await tx
    .update(accessRequests)
    .set({
      status: outcome.status,
      cancelReason: outcome.status === "cancelled" ? outcome.reason : null,
      decidedAt: now,
    })
    .where(and(eq(accessRequests.id, request.id), eq(accessRequests.status, "requested")));
  return releasePoints(tx, { creatorId: request.creatorId, accessRequestId: request.id });
}

/** The creator cancels their own pending request. */
export async function cancelAccessRequest(
  db: Database,
  input: { userId: string; requestId: string; now?: Date },
): Promise<{ ok: true; pointsReturned: number } | { ok: false; reason: "not_found" | "not_pending" }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(accessRequests)
      .where(and(eq(accessRequests.id, input.requestId), eq(accessRequests.userId, input.userId)))
      .for("update");
    if (!request) return { ok: false as const, reason: "not_found" as const };
    if (request.status !== "requested") return { ok: false as const, reason: "not_pending" as const };
    const pointsReturned = await endPending(tx, request, { status: "cancelled", reason: "creator" }, now);
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "access.cancelled",
      entityType: "access_request",
      entityId: request.id,
      metadata: { reason: "creator" },
    });
    return { ok: true as const, pointsReturned };
  });
}

/**
 * Cancels every pending request of a creator and returns the points — used
 * when membership is paused and when the Brand opportunities consent is
 * withdrawn. Locks the request rows before the points account.
 */
export async function cancelPendingAccessRequests(
  tx: DbExecutor,
  input: { creatorId: string; reason: Exclude<CancelReason, "creator">; now: Date },
): Promise<number> {
  const pending = await tx
    .select({ id: accessRequests.id, creatorId: accessRequests.creatorId })
    .from(accessRequests)
    .where(and(eq(accessRequests.creatorId, input.creatorId), eq(accessRequests.status, "requested")))
    .orderBy(asc(accessRequests.id))
    .for("update");
  for (const request of pending) {
    await endPending(tx, request, { status: "cancelled", reason: input.reason }, input.now);
    await recordAuditEvent(tx, {
      actorType: "system",
      eventType: "access.cancelled",
      entityType: "access_request",
      entityId: request.id,
      metadata: { reason: input.reason },
    });
  }
  return pending.length;
}

/**
 * Erases a creator's Access request history (Brand opportunities consent
 * withdrawn). Pending requests are cancelled and their points returned
 * first. Ledger rows stay (points earned and spent are not request data);
 * they keep only the request id. Must be called inside a transaction.
 */
export async function eraseAccessRequests(
  tx: DbExecutor,
  input: { creatorId: string; before?: Date; now?: Date },
): Promise<Record<string, number>> {
  const cancelled = await cancelPendingAccessRequests(tx, {
    creatorId: input.creatorId,
    reason: "consent_withdrawn",
    now: input.now ?? new Date(),
  });
  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const deleted = await tx
    .delete(accessRequests)
    .where(
      and(
        eq(accessRequests.creatorId, input.creatorId),
        input.before ? lte(accessRequests.createdAt, input.before) : undefined,
      ),
    )
    .returning({ id: accessRequests.id });
  await tx.execute(sql`set local creatorco.erasure = 'off'`);
  return { access_requests: deleted.length, access_requests_cancelled: cancelled };
}

/**
 * Expires pending requests past their deadline, or whose opportunity has
 * closed, and returns their points. Idempotent sweep (scheduled job).
 */
export async function expireAccessRequests(deps: { db: Database; now?: Date }): Promise<{ expired: number }> {
  const now = deps.now ?? new Date();
  const due = await deps.db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .innerJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
    .where(
      and(
        eq(accessRequests.status, "requested"),
        or(
          lte(accessRequests.expiresAt, now),
          eq(accessOpportunities.status, "closed"),
          lte(accessOpportunities.closesAt, now),
        ),
      ),
    )
    .orderBy(asc(accessRequests.expiresAt));
  let expired = 0;
  for (const { id } of due) {
    const done = await deps.db.transaction(async (tx) => {
      const [request] = await tx
        .select({ id: accessRequests.id, creatorId: accessRequests.creatorId, status: accessRequests.status })
        .from(accessRequests)
        .where(eq(accessRequests.id, id))
        .for("update", { skipLocked: true });
      if (!request || request.status !== "requested") return false;
      await endPending(tx, request, { status: "expired" }, now);
      await recordAuditEvent(tx, {
        actorType: "system",
        eventType: "access.expired",
        entityType: "access_request",
        entityId: request.id,
      });
      return true;
    });
    if (done) expired += 1;
  }
  return { expired };
}

// ---------------------------------------------------------------------------
// Partnerships desk
// ---------------------------------------------------------------------------

export interface QueueItem {
  requestId: string;
  status: AccessRequestStatus;
  requestedAt: Date;
  expiresAt: Date;
  pointsHeld: number;
  opportunityId: string;
  opportunityTitle: string;
  brandName: string;
  creatorDisplayName: string;
}

/** Requests for the desk (pending first, oldest first). Creator-professional summary only. */
export async function listAccessQueue(
  db: DbExecutor,
  input: { status?: AccessRequestStatus; limit?: number } = {},
): Promise<QueueItem[]> {
  const rows = await db
    .select({
      requestId: accessRequests.id,
      status: accessRequests.status,
      requestedAt: accessRequests.requestedAt,
      expiresAt: accessRequests.expiresAt,
      pointsHeld: accessRequests.pointsHeld,
      opportunityId: accessOpportunities.id,
      opportunityTitle: accessOpportunities.title,
      brandName: accessOpportunities.brandName,
      creatorDisplayName: creatorProfiles.displayName,
    })
    .from(accessRequests)
    .innerJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, accessRequests.creatorId))
    .where(input.status ? eq(accessRequests.status, input.status) : undefined)
    .orderBy(sql`(${accessRequests.status} = 'requested') desc`, asc(accessRequests.requestedAt))
    .limit(input.limit ?? 200);
  return rows;
}

export interface DeskRequestDetail {
  request: Pick<
    AccessRequest,
    | "id"
    | "status"
    | "note"
    | "pointsHeld"
    | "requestedAt"
    | "expiresAt"
    | "decidedAt"
    | "declineReason"
    | "cancelReason"
  >;
  opportunity: Opportunity;
  approved: number;
  /** Creator-professional summary only — never financial, eligibility or fraud data. */
  creator: {
    displayName: string;
    handle: string | null;
    category: string | null;
    city: string | null;
    tier: CreatorStatusTier;
    platforms: string[];
    signals: { key: string; value: number | boolean | null }[];
  };
}

/** A request with the creator-professional summary the desk needs. Viewing is audited. */
export async function getRequestForDesk(
  db: Database,
  input: { requestId: string; staffUserId: string },
): Promise<DeskRequestDetail | null> {
  const [row] = await db
    .select({ request: accessRequests, opportunity: accessOpportunities, profile: creatorProfiles })
    .from(accessRequests)
    .innerJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, accessRequests.creatorId))
    .where(eq(accessRequests.id, input.requestId))
    .limit(1);
  if (!row) return null;
  const { request, opportunity, profile } = row;
  const status = await getCurrentCreatorStatus(db, profile.id);
  const graph = await getLatestProfessionalGraph(db, profile.id);
  const accounts = await db
    .select({ platform: creatorSocialAccounts.platform })
    .from(creatorSocialAccounts)
    .where(
      and(eq(creatorSocialAccounts.creatorId, profile.id), eq(creatorSocialAccounts.connectionStatus, "connected")),
    );
  const approved = (await approvedCounts(db, [opportunity.id])).get(opportunity.id) ?? 0;

  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.staffUserId,
    eventType: "access.request_viewed",
    entityType: "access_request",
    entityId: request.id,
  });
  return {
    request: {
      id: request.id,
      status: request.status,
      note: request.note,
      pointsHeld: request.pointsHeld,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
      decidedAt: request.decidedAt,
      declineReason: request.declineReason,
      cancelReason: request.cancelReason,
    },
    opportunity,
    approved,
    creator: {
      displayName: profile.displayName,
      handle: profile.primaryCreatorHandle,
      category: profile.creatorCategory,
      city: profile.city,
      tier: status.tier,
      platforms: [...new Set(accounts.map((a) => a.platform))].sort(),
      signals: (graph?.features ?? [])
        .filter((f) => DESK_SIGNALS.includes(f.key))
        .map((f) => ({ key: f.key, value: f.value })),
    },
  };
}

/** Signals the desk sees — the same ones the creator sees on their Passport (not fraud results). */
const DESK_SIGNALS: string[] = [
  "professional_longevity_months",
  "connected_platforms",
  "total_audience",
  "engagement_rate_3m",
  "posting_consistency_12m",
  "engagement_stability",
];

/** Approves a pending request: its held points are spent. Places are enforced under the opportunity lock. */
export async function approveAccessRequest(
  db: Database,
  input: { requestId: string; staffUserId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, input.requestId))
      .for("update");
    if (!request) throw new AccessError("not_found");
    if (request.status !== "requested") throw new AccessError("not_pending");
    if (request.expiresAt <= now) throw new AccessError("expired");
    const [o] = await tx
      .select()
      .from(accessOpportunities)
      .where(eq(accessOpportunities.id, request.opportunityId))
      .for("no key update");
    const approved = (await approvedCounts(tx, [o!.id])).get(o!.id) ?? 0;
    if (approved >= o!.places) throw new AccessError("full");
    await tx
      .update(accessRequests)
      .set({ status: "approved", decidedAt: now, decidedBy: input.staffUserId })
      .where(eq(accessRequests.id, request.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.approved",
      entityType: "access_request",
      entityId: request.id,
      metadata: { points: request.pointsHeld },
    });
  });
}

/** Declines a pending request with a reason code and returns its points. */
export async function declineAccessRequest(
  db: Database,
  input: { requestId: string; staffUserId: string; reason: DeclineReason; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, input.requestId))
      .for("update");
    if (!request) throw new AccessError("not_found");
    if (request.status !== "requested") throw new AccessError("not_pending");
    await lockPointsAccount(tx, request.creatorId);
    await tx
      .update(accessRequests)
      .set({ status: "declined", decidedAt: now, decidedBy: input.staffUserId, declineReason: input.reason })
      .where(eq(accessRequests.id, request.id));
    await releasePoints(tx, { creatorId: request.creatorId, accessRequestId: request.id });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.declined",
      entityType: "access_request",
      entityId: request.id,
      metadata: { reason: input.reason },
    });
  });
}

export interface OpportunityInput {
  slug: string;
  brandName: string;
  title: string;
  kind: Opportunity["kind"];
  category: string;
  summary: string;
  minTier: CreatorStatusTier;
  pointsCost: number;
  places: number;
  opensAt: Date;
  closesAt: Date;
}

export async function createOpportunity(
  db: Database,
  input: { staffUserId: string; values: OpportunityInput },
): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(accessOpportunities)
        .values({ ...input.values, createdBy: input.staffUserId, updatedBy: input.staffUserId })
        .returning({ id: accessOpportunities.id });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.staffUserId,
        eventType: "access.opportunity_created",
        entityType: "access_opportunity",
        entityId: row!.id,
      });
      return row!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "access_opportunities_slug_key")) throw new AccessError("slug_taken");
    throw error;
  }
}

/** Edits an opportunity. Places can't be cut below the requests already approved. */
export async function updateOpportunity(
  db: Database,
  input: { staffUserId: string; opportunityId: string; values: Omit<OpportunityInput, "slug"> },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [o] = await tx
      .select()
      .from(accessOpportunities)
      .where(eq(accessOpportunities.id, input.opportunityId))
      .for("no key update");
    if (!o) throw new AccessError("not_found");
    const approved = (await approvedCounts(tx, [o.id])).get(o.id) ?? 0;
    if (input.values.places < approved) throw new AccessError("places_below_approved");
    await tx
      .update(accessOpportunities)
      .set({ ...input.values, updatedBy: input.staffUserId })
      .where(eq(accessOpportunities.id, o.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.opportunity_updated",
      entityType: "access_opportunity",
      entityId: o.id,
    });
  });
}

/** Closes an opportunity to new requests. Pending requests are expired by the next sweep (points returned). */
export async function closeOpportunity(
  db: Database,
  input: { staffUserId: string; opportunityId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [o] = await tx
      .update(accessOpportunities)
      .set({ status: "closed", updatedBy: input.staffUserId })
      .where(and(eq(accessOpportunities.id, input.opportunityId), eq(accessOpportunities.status, "open")))
      .returning({ id: accessOpportunities.id });
    if (!o) return;
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.opportunity_closed",
      entityType: "access_opportunity",
      entityId: o.id,
    });
  });
}

/** Opportunities for the desk, with approved and pending counts. */
export async function listOpportunitiesForDesk(db: DbExecutor) {
  const opportunities = await db
    .select()
    .from(accessOpportunities)
    .orderBy(desc(accessOpportunities.status), asc(accessOpportunities.closesAt));
  const counts = await db
    .select({ id: accessRequests.opportunityId, status: accessRequests.status, n: count() })
    .from(accessRequests)
    .groupBy(accessRequests.opportunityId, accessRequests.status);
  const n = (id: string, status: AccessRequestStatus) =>
    Number(counts.find((c) => c.id === id && c.status === status)?.n ?? 0);
  return opportunities.map((o) => ({ opportunity: o, approved: n(o.id, "approved"), pending: n(o.id, "requested") }));
}

export async function getOpportunity(db: DbExecutor, opportunityId: string) {
  const [o] = await db.select().from(accessOpportunities).where(eq(accessOpportunities.id, opportunityId)).limit(1);
  return o ?? null;
}

/** The consent text a creator is shown before their first request (current version). */
export async function brandOpportunitiesConsent(db: DbExecutor, now = new Date()) {
  const def = await getActiveDefinition(db, CONSENT_KEYS.brandOpportunities, now);
  if (!def) return null;
  const [row] = await db
    .select({
      id: consentDefinitions.id,
      title: consentDefinitions.title,
      body: consentDefinitions.body,
      version: consentDefinitions.version,
    })
    .from(consentDefinitions)
    .where(eq(consentDefinitions.id, def.id))
    .limit(1);
  return row ?? null;
}
