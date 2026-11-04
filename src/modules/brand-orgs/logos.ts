import { and, eq, inArray } from "drizzle-orm";

import { brandOrgClaims, brandOrgs } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

/**
 * Logos are shown only for brands whose VERIFIED organisation claimed the
 * directory entry and uploaded a logo that two admins approved and that
 * scanned clean. Otherwise the page shows a neutral monogram. Never scraped.
 */
const approvedLogo = and(
  eq(brandOrgClaims.status, "approved"),
  eq(brandOrgClaims.logoStatus, "approved"),
  eq(brandOrgClaims.logoScan, "clean"),
  eq(brandOrgs.status, "verified"),
);

export async function approvedLogoBrandIds(db: DbExecutor, directoryIds: string[]): Promise<Set<string>> {
  if (!directoryIds.length) return new Set();
  const rows = await db
    .select({ directoryId: brandOrgClaims.directoryId })
    .from(brandOrgClaims)
    .innerJoin(brandOrgs, eq(brandOrgs.id, brandOrgClaims.orgId))
    .where(and(inArray(brandOrgClaims.directoryId, directoryIds), approvedLogo));
  return new Set(rows.map((r) => r.directoryId));
}

/** The stored object behind an approved logo, or null. */
export async function approvedLogoFor(db: DbExecutor, directoryId: string) {
  const [row] = await db
    .select({ key: brandOrgClaims.logoKey, mime: brandOrgClaims.logoMime, provider: brandOrgClaims.logoProvider })
    .from(brandOrgClaims)
    .innerJoin(brandOrgs, eq(brandOrgs.id, brandOrgClaims.orgId))
    .where(and(eq(brandOrgClaims.directoryId, directoryId), approvedLogo))
    .limit(1);
  return row?.key && row.mime && row.provider ? { key: row.key, mime: row.mime, provider: row.provider } : null;
}
