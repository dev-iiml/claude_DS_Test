import { and, eq, lt, sql } from "drizzle-orm";

import { brandEmailChallenges, brandOrgInvites, publicPassportSlugRedirects, publicPassports } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { enqueueJob } from "@/modules/jobs";

import { revokeAllCodes } from "./codes-service";
import { unpublishPassport } from "./settings-service";

/**
 * Withdrawal effects (Stage 19). Processing stops at once; erasure removes
 * what only the public page needed (bio, photo, old links). The access log is
 * kept for the creator's own record. Returns small counts.
 */

/**
 * `public_passport` withdrawn: the page answers 410 straight away, indexing is turned off and every access code is
 * revoked — re-publishing later never brings old codes or unlock cookies back.
 */
export async function stopPublicPassport(tx: DbExecutor, input: { userId: string; now: Date }) {
  const unpublished = await unpublishPassport(tx, { userId: input.userId, now: input.now, reason: "withdrawal" });
  await revokeAllCodes(tx, input);
  return unpublished;
}

/** Any consent change may alter what the page can show: bump `cache_version` so no cached locked render is served. */
export async function invalidatePassportCache(tx: DbExecutor, userId: string) {
  await tx
    .update(publicPassports)
    .set({ cacheVersion: sql`${publicPassports.cacheVersion} + 1` })
    .where(eq(publicPassports.userId, userId));
}

/** Erasure scope `public_passport_content`: bio, photo (object deleted by a job) and slug redirects. */
export async function erasePublicPassportContent(
  tx: DbExecutor,
  input: { userId: string },
): Promise<Record<string, number>> {
  const [row] = await tx.select().from(publicPassports).where(eq(publicPassports.userId, input.userId)).for("update");
  if (!row) return { passport_content: 0 };
  await tx
    .update(publicPassports)
    .set({
      bio: null,
      photoKey: null,
      photoMime: null,
      photoProvider: null,
      photoScan: null,
      indexable: false,
      cacheVersion: row.cacheVersion + 1,
    })
    .where(eq(publicPassports.id, row.id));
  const redirects = await tx
    .delete(publicPassportSlugRedirects)
    .where(eq(publicPassportSlugRedirects.passportId, row.id))
    .returning({ slug: publicPassportSlugRedirects.slug });
  if (row.photoKey)
    await enqueueJob(tx, {
      type: "public_passport_purge",
      payload: { key: row.photoKey, provider: row.photoProvider ?? "mock" },
    });
  return { passport_content: 1, passport_photo_queued: row.photoKey ? 1 : 0, passport_redirects: redirects.length };
}

/** `passport_unlock` withdrawn: every code revoked, brands lose access, discoverability off. */
export async function stopPassportUnlocks(tx: DbExecutor, input: { userId: string; now: Date }) {
  const codes = await revokeAllCodes(tx, input);
  await tx
    .update(publicPassports)
    .set({ audience: "code_holders_only", discoverable: false, cacheVersion: sql`${publicPassports.cacheVersion} + 1` })
    .where(eq(publicPassports.userId, input.userId));
  return codes;
}

/** Daily housekeeping: expired link redirects, used/old brand email codes and long-expired invites. */
export async function passportHousekeeping(db: DbExecutor, now: Date) {
  const redirects = await db
    .delete(publicPassportSlugRedirects)
    .where(lt(publicPassportSlugRedirects.expiresAt, now))
    .returning({ slug: publicPassportSlugRedirects.slug });
  const challenges = await db
    .delete(brandEmailChallenges)
    .where(lt(brandEmailChallenges.createdAt, new Date(now.getTime() - 86_400_000)))
    .returning({ id: brandEmailChallenges.id });
  const invites = await db
    .delete(brandOrgInvites)
    .where(and(lt(brandOrgInvites.expiresAt, new Date(now.getTime() - 7 * 86_400_000))))
    .returning({ id: brandOrgInvites.id });
  return { redirects: redirects.length, email_codes: challenges.length, invites: invites.length };
}
