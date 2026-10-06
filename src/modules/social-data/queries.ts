import { and, count, desc, eq, ne } from "drizzle-orm";

import { creatorProfiles, creatorSocialAccounts, creatorSocialSnapshots, socialPlatforms } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

/**
 * A creator's own connected account with its latest metrics. Ownership is
 * enforced in the query (account → profile → user), never by the caller.
 */
export async function getOwnSocialAccount(db: DbExecutor, input: { userId: string; accountId: string }) {
  const [row] = await db
    .select({
      id: creatorSocialAccounts.id,
      platform: creatorSocialAccounts.platform,
      platformLabel: socialPlatforms.label,
      handle: creatorSocialAccounts.handle,
      declaredHandle: creatorSocialAccounts.declaredHandle,
      status: creatorSocialAccounts.connectionStatus,
      connectedAt: creatorSocialAccounts.connectedAt,
      accountCreatedAt: creatorSocialAccounts.accountCreatedAt,
      isPrimary: creatorSocialAccounts.isPrimary,
      creatorId: creatorSocialAccounts.creatorId,
    })
    .from(creatorSocialAccounts)
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, creatorSocialAccounts.creatorId))
    .innerJoin(socialPlatforms, eq(socialPlatforms.code, creatorSocialAccounts.platform))
    .where(and(eq(creatorSocialAccounts.id, input.accountId), eq(creatorProfiles.userId, input.userId)))
    .limit(1);
  if (!row) return null;

  const [latest] = await db
    .select({
      capturedAt: creatorSocialSnapshots.capturedAt,
      followers: creatorSocialSnapshots.followers,
      subscribers: creatorSocialSnapshots.subscribers,
      engagementRate: creatorSocialSnapshots.engagementRate,
    })
    .from(creatorSocialSnapshots)
    .where(eq(creatorSocialSnapshots.socialAccountId, row.id))
    .orderBy(desc(creatorSocialSnapshots.capturedAt))
    .limit(1);
  const [history] = await db
    .select({ n: count() })
    .from(creatorSocialSnapshots)
    .where(eq(creatorSocialSnapshots.socialAccountId, row.id));

  return {
    ...row,
    latest: latest
      ? {
          capturedAt: latest.capturedAt,
          audience: latest.followers ?? latest.subscribers,
          audienceLabel: latest.subscribers !== null && latest.followers === null ? "Subscribers" : "Followers",
          engagementRate: latest.engagementRate === null ? null : Number(latest.engagementRate),
        }
      : null,
    historyMonths: history?.n ?? 0,
    otherAccountsOnPlatform: await countOtherActive(db, row),
  };
}

async function countOtherActive(db: DbExecutor, row: { id: string; creatorId: string; platform: string }) {
  const rows = await db
    .select({ id: creatorSocialAccounts.id })
    .from(creatorSocialAccounts)
    .where(
      and(
        eq(creatorSocialAccounts.creatorId, row.creatorId),
        eq(creatorSocialAccounts.platform, row.platform),
        ne(creatorSocialAccounts.connectionStatus, "disconnected"),
        ne(creatorSocialAccounts.id, row.id),
      ),
    );
  return rows.length;
}
