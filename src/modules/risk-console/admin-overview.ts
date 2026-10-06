import { count, desc, eq, gte, sql } from "drizzle-orm";

import {
  auditEvents,
  consentDefinitions,
  consentReceipts,
  dataErasureRequests,
  creatorProfiles,
  creatorSocialAccounts,
  professionalGraphRuns,
  providerRequests,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { countApplicationsByStatus } from "@/modules/financial-eligibility/application-service";

/**
 * Aggregate-only overview for the admin placeholder. No personal fields are
 * selected; the full risk console (Stage 12) will add audited, role-scoped
 * access to individual records.
 */
export async function getAdminOverview(db: DbExecutor, now = new Date()) {
  const [creators] = await db.select({ n: count() }).from(users).where(eq(users.role, "creator"));

  const byStatus = await db
    .select({ status: creatorProfiles.profileStatus, n: count() })
    .from(creatorProfiles)
    .groupBy(creatorProfiles.profileStatus);

  const byGst = await db
    .select({ gstStatus: sql<string>`coalesce(${creatorProfiles.gstStatus}, 'not_declared')`, n: count() })
    .from(creatorProfiles)
    .groupBy(sql`coalesce(${creatorProfiles.gstStatus}, 'not_declared')`);

  const recentEvents = await db
    .select({
      id: auditEvents.id,
      eventType: auditEvents.eventType,
      entityType: auditEvents.entityType,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(10);

  const [connected] = await db
    .select({ n: count() })
    .from(creatorSocialAccounts)
    .where(eq(creatorSocialAccounts.connectionStatus, "connected"));
  const [graphRuns] = await db.select({ n: count() }).from(professionalGraphRuns);

  // Provider calls in the last 24 hours — operation and outcome only, never payloads.
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const providerCalls = await db
    .select({
      kind: providerRequests.providerKind,
      key: providerRequests.providerKey,
      outcome: providerRequests.outcome,
      n: count(),
    })
    .from(providerRequests)
    .where(gte(providerRequests.createdAt, since))
    .groupBy(providerRequests.providerKind, providerRequests.providerKey, providerRequests.outcome);

  // Consent and erasure aggregates (counts only).
  const consentCounts = await db
    .select({ key: consentDefinitions.key, status: consentReceipts.status, n: count() })
    .from(consentReceipts)
    .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
    .groupBy(consentDefinitions.key, consentReceipts.status);
  const erasures = await db
    .select({ scope: dataErasureRequests.scope, status: dataErasureRequests.status, n: count() })
    .from(dataErasureRequests)
    .groupBy(dataErasureRequests.scope, dataErasureRequests.status);

  const applications = await countApplicationsByStatus(db);

  const statusCount = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;

  return {
    creatorAccounts: creators?.n ?? 0,
    profilesCompleted: statusCount("completed"),
    profilesInDraft: statusCount("draft"),
    gstBreakdown: byGst.sort((a, b) => a.gstStatus.localeCompare(b.gstStatus)),
    profilesPaused: statusCount("paused"),
    applications: applications.sort((a, b) => a.status.localeCompare(b.status)),
    consents: [...new Set(consentCounts.map((c) => c.key))].sort().map((key) => ({
      key,
      granted: consentCounts.find((c) => c.key === key && c.status === "granted")?.n ?? 0,
      withdrawn: consentCounts.find((c) => c.key === key && c.status === "withdrawn")?.n ?? 0,
    })),
    erasures: erasures.sort((a, b) => `${a.scope}${a.status}`.localeCompare(`${b.scope}${b.status}`)),
    connectedAccounts: connected?.n ?? 0,
    graphRuns: graphRuns?.n ?? 0,
    providerCalls: providerCalls.sort((a, b) => `${a.kind}${a.outcome}`.localeCompare(`${b.kind}${b.outcome}`)),
    recentEvents,
  };
}
