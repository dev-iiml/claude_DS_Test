import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  accessOpportunities,
  accessRequests,
  brands,
  creatorCategories,
  creatorProfiles,
  creatorSocialAccounts,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { getCreatorStatus } from "@/modules/creator-status/status-service";
import type { CreatorStatusTier } from "@/modules/creator-status/status";
import { getLatestProfessionalGraph } from "@/modules/professional-graph/graph-service";

import type { AccessDeclineReason, AccessRequestStatus } from "./domain";

/**
 * Partnerships-desk views of Access requests. Creator-professional data only —
 * exactly the summary the `brand_opportunities` consent describes (display
 * name, handles, categories, city, Creator Status, connected platforms and
 * total audience, the creator's note). Never financial data; never the `fin`
 * schema. Opening a request is audited.
 */

export interface StaffRequestRow {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  brandName: string;
  displayName: string;
  tierAtRequest: CreatorStatusTier;
  pointsHeld: number;
  status: AccessRequestStatus;
  requestedAt: Date;
}

export async function listRequestsForStaff(
  db: DbExecutor,
  input: { status?: AccessRequestStatus; opportunityId?: string; limit?: number } = {},
): Promise<StaffRequestRow[]> {
  const rows = await db
    .select({
      r: accessRequests,
      title: accessOpportunities.title,
      brandName: brands.name,
      displayName: creatorProfiles.displayName,
    })
    .from(accessRequests)
    .innerJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
    .innerJoin(brands, eq(brands.id, accessOpportunities.brandId))
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, accessRequests.creatorId))
    .where(
      and(
        input.status ? eq(accessRequests.status, input.status) : undefined,
        input.opportunityId ? eq(accessRequests.opportunityId, input.opportunityId) : undefined,
      ),
    )
    .orderBy(input.status === "requested" ? asc(accessRequests.requestedAt) : desc(accessRequests.requestedAt))
    .limit(input.limit ?? 100);
  return rows.map(({ r, title, brandName, displayName }) => ({
    id: r.id,
    opportunityId: r.opportunityId,
    opportunityTitle: title,
    brandName,
    displayName: displayName ?? "Creator",
    tierAtRequest: r.tierAtRequest,
    pointsHeld: r.pointsHeld,
    status: r.status,
    requestedAt: r.requestedAt,
  }));
}

export interface StaffRequestDetail {
  id: string;
  status: AccessRequestStatus;
  pointsHeld: number;
  tierAtRequest: CreatorStatusTier;
  note: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  declineReason: AccessDeclineReason | null;
  opportunity: { id: string; title: string; brandName: string; seats: number; status: string };
  creator: {
    displayName: string;
    handle: string | null;
    city: string | null;
    category: string | null;
    currentTier: CreatorStatusTier;
    platforms: string[];
    totalAudience: number | null;
    paused: boolean;
  };
}

export async function getRequestForStaff(
  db: DbExecutor,
  input: { requestId: string; staffUserId: string },
): Promise<StaffRequestDetail | null> {
  const [row] = await db
    .select({
      r: accessRequests,
      title: accessOpportunities.title,
      seats: accessOpportunities.seats,
      oStatus: accessOpportunities.status,
      brandName: brands.name,
      profile: {
        id: creatorProfiles.id,
        displayName: creatorProfiles.displayName,
        handle: creatorProfiles.primaryCreatorHandle,
        city: creatorProfiles.city,
        category: creatorProfiles.creatorCategory,
        status: creatorProfiles.profileStatus,
      },
    })
    .from(accessRequests)
    .innerJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
    .innerJoin(brands, eq(brands.id, accessOpportunities.brandId))
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, accessRequests.creatorId))
    .where(eq(accessRequests.id, input.requestId));
  if (!row) return null;
  const [status, graph, accounts, category] = await Promise.all([
    getCreatorStatus(db, row.profile.id),
    getLatestProfessionalGraph(db, row.profile.id),
    db
      .select({ platform: creatorSocialAccounts.platform })
      .from(creatorSocialAccounts)
      .where(
        and(
          eq(creatorSocialAccounts.creatorId, row.profile.id),
          inArray(creatorSocialAccounts.connectionStatus, ["connected"]),
        ),
      ),
    row.profile.category
      ? db
          .select({ label: creatorCategories.label })
          .from(creatorCategories)
          .where(eq(creatorCategories.code, row.profile.category))
      : Promise.resolve([]),
  ]);
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.staffUserId,
    eventType: "access.request_viewed",
    entityType: "access_request",
    entityId: row.r.id,
    metadata: {},
  });
  const audience = graph?.features.find((f) => f.key === "total_audience")?.value;
  return {
    id: row.r.id,
    status: row.r.status,
    pointsHeld: row.r.pointsHeld,
    tierAtRequest: row.r.tierAtRequest,
    note: row.r.note,
    requestedAt: row.r.requestedAt,
    decidedAt: row.r.decidedAt,
    declineReason: row.r.declineReason,
    opportunity: {
      id: row.r.opportunityId,
      title: row.title,
      brandName: row.brandName,
      seats: row.seats,
      status: row.oStatus,
    },
    creator: {
      displayName: row.profile.displayName ?? "Creator",
      handle: row.profile.handle,
      city: row.profile.city,
      category: category[0]?.label ?? null,
      currentTier: status.tier,
      platforms: [...new Set(accounts.map((a) => a.platform))].sort(),
      totalAudience: typeof audience === "number" ? audience : null,
      paused: row.profile.status !== "completed",
    },
  };
}

export async function countPendingRequests(db: DbExecutor) {
  const rows = await db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .where(eq(accessRequests.status, "requested"));
  return rows.length;
}
