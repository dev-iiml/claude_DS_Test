import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { accessOpportunities, accessRequests, brands } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { currentTier } from "@/modules/creator-status/status-service";
import { meetsTier, type CreatorStatusTier } from "@/modules/creator-status/status";
import { pointsBalance } from "@/modules/rewards/ledger-service";

import type { AccessRequestStatus, OpportunityKind, OpportunityStatus } from "./domain";
import { AccessError } from "./errors";
import { expireRequestsFor } from "./request-service";
import type { OpportunityInput } from "./schemas";

/**
 * Access opportunities (Stage 14). Phase 1: samples from fictional brands,
 * created by seed or by the partnerships desk. Creators see live ones whose
 * request window is open; staff see everything.
 */

/** Why a creator can or can't request right now. */
export type CreatorAvailability =
  "open" | "requested" | "approved" | "tier_locked" | "insufficient_points" | "full" | "not_open_yet" | "closed";

export interface CreatorOpportunityView {
  id: string;
  title: string;
  kind: OpportunityKind;
  category: string;
  summary: string;
  details: string;
  brand: { name: string; isSample: boolean };
  minTier: CreatorStatusTier;
  pointsCost: number;
  seatsLeft: number;
  opensAt: Date;
  closesAt: Date;
  isSample: boolean;
  availability: CreatorAvailability;
  /** The creator's latest request for this opportunity, if any. */
  request: {
    id: string;
    status: AccessRequestStatus;
    pointsHeld: number;
    requestedAt: Date;
    /** The creator's own note with the request. */
    note: string | null;
    declineReason: string | null;
  } | null;
}

async function approvedCounts(db: DbExecutor, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db
    .select({ id: accessRequests.opportunityId, n: count() })
    .from(accessRequests)
    .where(and(inArray(accessRequests.opportunityId, ids), eq(accessRequests.status, "approved")))
    .groupBy(accessRequests.opportunityId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

function availabilityFor(
  o: { minTier: CreatorStatusTier; pointsCost: number; opensAt: Date; closesAt: Date; status: OpportunityStatus },
  ctx: { tier: CreatorStatusTier; balance: number; seatsLeft: number; requestStatus: AccessRequestStatus | null },
  now: Date,
): CreatorAvailability {
  if (ctx.requestStatus === "approved") return "approved";
  if (ctx.requestStatus === "requested") return "requested";
  if (o.status !== "live" || o.closesAt.getTime() <= now.getTime()) return "closed";
  if (o.opensAt.getTime() > now.getTime()) return "not_open_yet";
  if (ctx.seatsLeft <= 0) return "full";
  if (!meetsTier(ctx.tier, o.minTier)) return "tier_locked";
  if (ctx.balance < o.pointsCost) return "insufficient_points";
  return "open";
}

async function creatorViews(
  db: DbExecutor,
  input: { userId: string; creatorId: string; now: Date; opportunityId?: string },
): Promise<CreatorOpportunityView[]> {
  const rows = await db
    .select({ o: accessOpportunities, brandName: brands.name, brandSample: brands.isSample })
    .from(accessOpportunities)
    .innerJoin(brands, eq(brands.id, accessOpportunities.brandId))
    .where(
      input.opportunityId
        ? and(eq(accessOpportunities.id, input.opportunityId), inArray(accessOpportunities.status, ["live", "closed"]))
        : and(eq(accessOpportunities.status, "live"), gt(accessOpportunities.closesAt, input.now)),
    )
    .orderBy(asc(accessOpportunities.closesAt), asc(accessOpportunities.title));
  const ids = rows.map((r) => r.o.id);
  const [approved, tier, balance, requests] = await Promise.all([
    approvedCounts(db, ids),
    currentTier(db, input.creatorId),
    pointsBalance(db, input.creatorId),
    ids.length
      ? db
          .select()
          .from(accessRequests)
          .where(and(eq(accessRequests.creatorId, input.creatorId), inArray(accessRequests.opportunityId, ids)))
          .orderBy(desc(accessRequests.requestedAt))
      : Promise.resolve([]),
  ]);
  return rows.map(({ o, brandName, brandSample }) => {
    const latest = requests.find((r) => r.opportunityId === o.id) ?? null;
    const seatsLeft = Math.max(0, o.seats - (approved.get(o.id) ?? 0));
    return {
      id: o.id,
      title: o.title,
      kind: o.kind,
      category: o.category,
      summary: o.summary,
      details: o.details,
      brand: { name: brandName, isSample: brandSample },
      minTier: o.minTier,
      pointsCost: o.pointsCost,
      seatsLeft,
      opensAt: o.opensAt,
      closesAt: o.closesAt,
      isSample: o.isSample,
      availability: availabilityFor(o, { tier, balance, seatsLeft, requestStatus: latest?.status ?? null }, input.now),
      request: latest
        ? {
            id: latest.id,
            status: latest.status,
            pointsHeld: latest.pointsHeld,
            requestedAt: latest.requestedAt,
            note: latest.note,
            declineReason: latest.declineReason,
          }
        : null,
    };
  });
}

/** Live opportunities whose window hasn't closed, with what this creator can do on each. */
export async function listOpportunitiesForCreator(
  db: DbExecutor,
  input: { userId: string; creatorId: string; now?: Date },
): Promise<CreatorOpportunityView[]> {
  return creatorViews(db, { ...input, now: input.now ?? new Date() });
}

/** One live or closed opportunity (drafts are invisible to creators). */
export async function getOpportunityForCreator(
  db: DbExecutor,
  input: { userId: string; creatorId: string; opportunityId: string; now?: Date },
): Promise<CreatorOpportunityView | null> {
  const [view] = await creatorViews(db, { ...input, now: input.now ?? new Date() });
  return view ?? null;
}

// ── Partnerships desk ─────────────────────────────────────────────────────

export async function listBrands(db: DbExecutor) {
  return db.select().from(brands).orderBy(asc(brands.name));
}

export interface StaffOpportunityRow {
  id: string;
  title: string;
  brandName: string;
  kind: OpportunityKind;
  status: OpportunityStatus;
  minTier: CreatorStatusTier;
  pointsCost: number;
  seats: number;
  approved: number;
  pending: number;
  opensAt: Date;
  closesAt: Date;
  isSample: boolean;
}

export async function listOpportunitiesForStaff(db: DbExecutor): Promise<StaffOpportunityRow[]> {
  const rows = await db
    .select({ o: accessOpportunities, brandName: brands.name })
    .from(accessOpportunities)
    .innerJoin(brands, eq(brands.id, accessOpportunities.brandId))
    .orderBy(
      sql`case ${accessOpportunities.status} when 'live' then 0 when 'draft' then 1 else 2 end`,
      asc(accessOpportunities.closesAt),
    );
  const counts = await db
    .select({ id: accessRequests.opportunityId, status: accessRequests.status, n: count() })
    .from(accessRequests)
    .where(inArray(accessRequests.status, ["requested", "approved"]))
    .groupBy(accessRequests.opportunityId, accessRequests.status);
  const n = (id: string, status: string) => Number(counts.find((c) => c.id === id && c.status === status)?.n ?? 0);
  return rows.map(({ o, brandName }) => ({
    id: o.id,
    title: o.title,
    brandName,
    kind: o.kind,
    status: o.status,
    minTier: o.minTier,
    pointsCost: o.pointsCost,
    seats: o.seats,
    approved: n(o.id, "approved"),
    pending: n(o.id, "requested"),
    opensAt: o.opensAt,
    closesAt: o.closesAt,
    isSample: o.isSample,
  }));
}

export async function getOpportunityForStaff(db: DbExecutor, id: string) {
  const [row] = await db
    .select({ o: accessOpportunities, brandName: brands.name })
    .from(accessOpportunities)
    .innerJoin(brands, eq(brands.id, accessOpportunities.brandId))
    .where(eq(accessOpportunities.id, id));
  return row ? { ...row.o, brandName: row.brandName } : null;
}

export async function createOpportunity(db: Database, input: { staffUserId: string; values: OpportunityInput }) {
  return db.transaction(async (tx) => {
    const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, input.values.brandId));
    if (!brand) throw new AccessError("invalid", "Choose a brand.");
    const [row] = await tx
      .insert(accessOpportunities)
      .values({ ...input.values, isSample: true, createdBy: input.staffUserId })
      .returning({ id: accessOpportunities.id });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.opportunity_created",
      entityType: "access_opportunity",
      entityId: row!.id,
      metadata: { status: input.values.status, min_tier: input.values.minTier, points_cost: input.values.pointsCost },
    });
    return row!.id;
  });
}

/**
 * Edits an opportunity that isn't closed. Changing the cost or tier never
 * touches requests already made (each request records the points it held).
 */
export async function updateOpportunity(
  db: Database,
  input: { staffUserId: string; id: string; values: OpportunityInput },
) {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: accessOpportunities.status })
      .from(accessOpportunities)
      .where(eq(accessOpportunities.id, input.id))
      .for("update");
    if (!current) throw new AccessError("not_found");
    if (current.status === "closed") throw new AccessError("wrong_state", "A closed opportunity can't be edited.");
    if (current.status === "live" && input.values.status === "draft") {
      const [pending] = await tx
        .select({ n: count() })
        .from(accessRequests)
        .where(
          and(eq(accessRequests.opportunityId, input.id), inArray(accessRequests.status, ["requested", "approved"])),
        );
      if (Number(pending?.n ?? 0) > 0)
        throw new AccessError("wrong_state", "Creators have requested this — close it instead of unpublishing.");
    }
    const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, input.values.brandId));
    if (!brand) throw new AccessError("invalid", "Choose a brand.");
    const [approved] = await tx
      .select({ n: count() })
      .from(accessRequests)
      .where(and(eq(accessRequests.opportunityId, input.id), eq(accessRequests.status, "approved")));
    if (input.values.seats < Number(approved?.n ?? 0))
      throw new AccessError("invalid", `${approved!.n} places are already approved — places can't go below that.`);
    await tx.update(accessOpportunities).set(input.values).where(eq(accessOpportunities.id, input.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.opportunity_updated",
      entityType: "access_opportunity",
      entityId: input.id,
      metadata: { status: input.values.status, min_tier: input.values.minTier, points_cost: input.values.pointsCost },
    });
  });
}

/** Closes an opportunity to new requests; pending requests expire and their points are returned. */
export async function closeOpportunity(db: Database, input: { staffUserId: string; id: string; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: accessOpportunities.status })
      .from(accessOpportunities)
      .where(eq(accessOpportunities.id, input.id))
      .for("update");
    if (!current) throw new AccessError("not_found");
    if (current.status === "closed") return { expired: 0 };
    await tx.update(accessOpportunities).set({ status: "closed" }).where(eq(accessOpportunities.id, input.id));
    const expired = await expireRequestsFor(tx, { opportunityId: input.id, now });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "access.opportunity_closed",
      entityType: "access_opportunity",
      entityId: input.id,
      metadata: { expired_requests: expired },
    });
    return { expired };
  });
}
