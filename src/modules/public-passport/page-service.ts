import { and, eq, gt, inArray } from "drizzle-orm";

import { creatorProfiles, passportTakedowns, publicPassportSlugRedirects, publicPassports, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import { normaliseFieldTiers, type ViewerAccess } from "./domain";
import { decodeUnlock } from "./keys";
import { codeUnlockValid } from "./codes-service";
import { loadPassportSource } from "./source";
import { buildPassportView, OPEN_TIERS, publicSummary, type PassportSource, type PublicPassportView } from "./view";
import type { PassportRow } from "./settings-service";

/**
 * Serving a public passport (Stage 19). A passport is live only while it is
 * published, its `public_passport` consent is in force, the creator's
 * membership is active, no takedown applies and the `/ops` switch is on.
 * Anything else — including a slug that never existed — is "gone", answered
 * identically, so links can't be probed.
 */

export type Resolution =
  { kind: "live"; passport: PassportRow } | { kind: "redirect"; slug: string } | { kind: "gone" };

export async function isPassportLive(db: DbExecutor, passport: PassportRow, now = new Date()): Promise<boolean> {
  if (passport.status !== "published" || !passport.slug) return false;
  const [owner] = await db
    .select({ userStatus: users.status, profileStatus: creatorProfiles.profileStatus })
    .from(users)
    .innerJoin(creatorProfiles, eq(creatorProfiles.userId, users.id))
    .where(eq(users.id, passport.userId));
  if (owner?.userStatus !== "active" || owner.profileStatus !== "completed") return false;
  const [down] = await db
    .select({ id: passportTakedowns.id })
    .from(passportTakedowns)
    .where(
      and(
        eq(passportTakedowns.passportId, passport.id),
        inArray(passportTakedowns.status, ["offline", "permanent_proposed", "permanent"]),
      ),
    )
    .limit(1);
  if (down) return false;
  return (
    (await isFeatureEnabled(db, "public_passports")) &&
    (await hasValidConsent(db, passport.userId, CONSENT_KEYS.publicPassport, now))
  );
}

export async function resolvePassportSlug(db: DbExecutor, rawSlug: string, now = new Date()): Promise<Resolution> {
  const slug = rawSlug.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) return { kind: "gone" };
  const [passport] = await db.select().from(publicPassports).where(eq(publicPassports.slug, slug)).limit(1);
  if (passport) return (await isPassportLive(db, passport, now)) ? { kind: "live", passport } : { kind: "gone" };
  const [redirect] = await db
    .select({ passportId: publicPassportSlugRedirects.passportId })
    .from(publicPassportSlugRedirects)
    .where(and(eq(publicPassportSlugRedirects.slug, slug), gt(publicPassportSlugRedirects.expiresAt, now)))
    .limit(1);
  if (redirect) {
    const [target] = await db
      .select()
      .from(publicPassports)
      .where(eq(publicPassports.id, redirect.passportId))
      .limit(1);
    if (target?.slug && (await isPassportLive(db, target, now))) return { kind: "redirect", slug: target.slug };
  }
  return { kind: "gone" };
}

// ── Locked-view cache ───────────────────────────────────────────────────────

/**
 * The locked render is the same for every stranger, so it is cached in-process
 * for up to 5 minutes, keyed by the passport's `cache_version`. Any settings
 * change, withdrawal or takedown bumps the version (or makes the passport not
 * live), so a stale entry is never served — on every instance, without a purge
 * message. Unlocked renders are never cached.
 */
const LOCKED_TTL_MS = 5 * 60_000;
const lockedCache = new Map<string, { version: number; expires: number; source: PassportSource }>();

export function clearLockedCache(passportId?: string) {
  if (passportId) lockedCache.delete(passportId);
  else lockedCache.clear();
}

async function sourceFor(db: DbExecutor, passport: PassportRow, now: Date): Promise<PassportSource | null> {
  return loadPassportSource(
    db,
    { userId: passport.userId, creatorId: passport.creatorId },
    {
      includePrivateInTotals: passport.includePrivateInTotals,
      hasPhoto: Boolean(passport.photoKey && passport.photoScan === "clean"),
      bio: passport.bio,
      now,
    },
  );
}

async function cachedLockedSource(db: DbExecutor, passport: PassportRow, now: Date) {
  const hit = lockedCache.get(passport.id);
  if (hit && hit.version === passport.cacheVersion && hit.expires > now.getTime()) return hit.source;
  const source = await sourceFor(db, passport, now);
  if (source)
    lockedCache.set(passport.id, { version: passport.cacheVersion, expires: now.getTime() + LOCKED_TTL_MS, source });
  return source;
}

/** The view a viewer gets. `locked` views may come from the cache; `unlocked` views are always built fresh. */
export async function passportViewFor(
  db: DbExecutor,
  passport: PassportRow,
  access: ViewerAccess,
  now = new Date(),
): Promise<PublicPassportView | null> {
  const source = access === "locked" ? await cachedLockedSource(db, passport, now) : await sourceFor(db, passport, now);
  return source ? buildPassportView(source, normaliseFieldTiers(passport.fieldTiers), access) : null;
}

/** Title and short lines for the share image / metadata — public tier only. */
export async function passportSummaryFor(db: DbExecutor, passport: PassportRow, now = new Date()) {
  const source = await cachedLockedSource(db, passport, now);
  return source ? publicSummary(source, normaliseFieldTiers(passport.fieldTiers)) : null;
}

/** The owner's preview material: every field shown (bands only), recomposed in the browser by `composePreview`. */
export async function ownerPreviewMaterial(db: DbExecutor, passport: PassportRow, now = new Date()) {
  const source = await sourceFor(db, passport, now);
  return source ? buildPassportView(source, OPEN_TIERS, "unlocked") : null;
}

/** A creator previewing their own page as a stranger or as an unlocker (never more than an unlocker sees). */
export async function previewFor(db: DbExecutor, passport: PassportRow, as: ViewerAccess, now = new Date()) {
  const source = await sourceFor(db, passport, now);
  return source ? buildPassportView(source, normaliseFieldTiers(passport.fieldTiers), as) : null;
}

// ── Viewer access ───────────────────────────────────────────────────────────

export type ViewerVia = "direct" | "code" | "brand";

/** Whether an unlock cookie for this passport is still valid (signature, expiry, code still active, unlocks allowed). */
export async function codeAccess(
  db: DbExecutor,
  passport: PassportRow,
  cookieValue: string | undefined,
  now = new Date(),
  /** The viewer's VERIFIED organisation, for codes the creator scoped to one. */
  viewerOrgId: string | null = null,
) {
  const codeId = decodeUnlock(passport.id, cookieValue, now.getTime());
  if (!codeId) return false;
  return codeUnlockValid(db, { passportId: passport.id, userId: passport.userId, codeId, now, viewerOrgId });
}

/**
 * The partnerships desk's "view as a stranger": the LOCKED tier only (there is
 * no staff unlock bypass), shown even while a takedown applies so a reviewer
 * can judge the page — but never once the creator withdrew or unpublished.
 */
export async function staffLockedView(db: DbExecutor, passportId: string, now = new Date()) {
  const [p] = await db.select().from(publicPassports).where(eq(publicPassports.id, passportId));
  if (!p || p.status !== "published") return null;
  if (!(await hasValidConsent(db, p.userId, CONSENT_KEYS.publicPassport, now))) return null;
  return previewFor(db, p, "locked", now);
}
