import { and, eq, gt, ne, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  consentReceipts,
  creatorProfiles,
  creatorSocialAccounts,
  publicPassportSlugRedirects,
  publicPassports,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { restrictedTextKinds } from "@/lib/restricted-text";
import { recordEvent } from "@/modules/analytics";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, findValidReceipt, grantConsent, hasValidConsent, type ConsentSource } from "@/modules/consent";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import {
  BIO_MAX,
  isTierAllowed,
  normaliseFieldTiers,
  PASSPORT_FIELDS,
  SLUG_REDIRECT_DAYS,
  slugProblem,
  suggestSlug,
  type FieldTier,
  type FieldTiers,
  type PassportField,
  type UnlockAudience,
} from "./domain";
import { PassportError } from "./errors";

/**
 * The creator's sharing settings (Stage 19). Every change bumps
 * `cache_version`, so a cached locked render is never served after it.
 * Publishing needs the `public_passport` consent; unlocking (codes, verified
 * brands, discoverability) needs `passport_unlock` — each granted inline, from
 * its own prompt, never bundled with anything else.
 */

export type PassportRow = typeof publicPassports.$inferSelect;

async function profileFor(db: DbExecutor, userId: string) {
  const [p] = await db
    .select({
      id: creatorProfiles.id,
      status: creatorProfiles.profileStatus,
      handle: creatorProfiles.primaryCreatorHandle,
    })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);
  if (!p || p.status !== "completed") throw new PassportError("not_eligible", "Complete your profile first.");
  return p;
}

/** The creator's passport row, created as a draft on first use. */
export async function ensurePassport(db: DbExecutor, userId: string): Promise<PassportRow> {
  const profile = await profileFor(db, userId);
  const [existing] = await db.select().from(publicPassports).where(eq(publicPassports.creatorId, profile.id)).limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(publicPassports)
    .values({ creatorId: profile.id, userId, fieldTiers: {} })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [again] = await db.select().from(publicPassports).where(eq(publicPassports.creatorId, profile.id)).limit(1);
  return again!;
}

async function lockOwn(tx: DbExecutor, userId: string): Promise<PassportRow> {
  const row = await ensurePassport(tx, userId);
  const [locked] = await tx.select().from(publicPassports).where(eq(publicPassports.id, row.id)).for("update");
  return locked!;
}

const bump = (row: PassportRow) => ({ cacheVersion: row.cacheVersion + 1 });

async function audit(tx: DbExecutor, userId: string, passportId: string, eventType: string, metadata = {}) {
  await recordAuditEvent(tx, {
    actorType: "user",
    actorId: userId,
    eventType,
    entityType: "public_passport",
    entityId: passportId,
    metadata,
  });
}

/** Whether the creator has at least one connected, verified social account (impersonation guard). */
export async function hasVerifiedAccount(db: DbExecutor, creatorId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(creatorSocialAccounts)
    .where(
      and(eq(creatorSocialAccounts.creatorId, creatorId), eq(creatorSocialAccounts.connectionStatus, "connected")),
    );
  return Number(row?.n ?? 0) > 0;
}

export interface SharingState {
  passport: PassportRow;
  tiers: FieldTiers;
  published: boolean;
  suggestedSlug: string;
  canPublish: { profile: boolean; verifiedAccount: boolean; feature: boolean };
  consents: { publicPassport: boolean; passportUnlock: boolean };
}

export async function getSharingState(db: Database, userId: string, now = new Date()): Promise<SharingState> {
  const profile = await profileFor(db, userId);
  const passport = await ensurePassport(db, userId);
  const [verifiedAccount, feature, publicConsent, unlockConsent] = await Promise.all([
    hasVerifiedAccount(db, profile.id),
    isFeatureEnabled(db, "public_passports"),
    hasValidConsent(db, userId, CONSENT_KEYS.publicPassport, now),
    hasValidConsent(db, userId, CONSENT_KEYS.passportUnlock, now),
  ]);
  return {
    passport,
    tiers: normaliseFieldTiers(passport.fieldTiers),
    published: passport.status === "published" && publicConsent,
    suggestedSlug: passport.slug ?? suggestSlug(profile.handle),
    canPublish: { profile: true, verifiedAccount, feature },
    consents: { publicPassport: publicConsent, passportUnlock: unlockConsent },
  };
}

/** Grants a sharing consent from the prompt the creator just answered, if it isn't in force already. */
async function ensureSharingConsent(
  tx: DbExecutor,
  input: {
    userId: string;
    key: typeof CONSENT_KEYS.publicPassport | typeof CONSENT_KEYS.passportUnlock;
    consentDefinitionId?: string | null;
    source: ConsentSource;
    surface: string;
    metadata?: Record<string, string | boolean>;
    now: Date;
  },
) {
  if (await hasValidConsent(tx, input.userId, input.key, input.now)) return;
  if (!input.consentDefinitionId) throw new PassportError("consent_required", "Agree to the consent to continue.");
  try {
    await grantConsent(tx, {
      userId: input.userId,
      key: input.key,
      consentDefinitionId: input.consentDefinitionId,
      source: input.source,
      metadata: { surface: input.surface, ...(input.metadata ?? {}) },
      now: input.now,
    });
  } catch {
    throw new PassportError("consent_required", "The consent text has been updated. Reload and review it.");
  }
  const receipt = await findValidReceipt(tx, input.userId, input.key, input.now);
  if (!receipt) throw new PassportError("consent_required");
  // Hold the receipt so a concurrent withdrawal either commits first or waits for us.
  await tx
    .select({ id: consentReceipts.id })
    .from(consentReceipts)
    .where(eq(consentReceipts.id, receipt.id))
    .for("share");
}

// ── Field tiers, bio and toggles ────────────────────────────────────────────

export async function updateFieldTiers(
  db: Database,
  input: { userId: string; tiers: Partial<Record<PassportField, FieldTier>> },
) {
  for (const [field, tier] of Object.entries(input.tiers)) {
    if (
      !(PASSPORT_FIELDS as readonly string[]).includes(field) ||
      !tier ||
      !isTierAllowed(field as PassportField, tier)
    )
      throw new PassportError("invalid", "That visibility isn't available for this field.");
  }
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, input.userId);
    const tiers = normaliseFieldTiers({ ...normaliseFieldTiers(row.fieldTiers), ...input.tiers });
    await tx
      .update(publicPassports)
      .set({ fieldTiers: tiers, ...bump(row) })
      .where(eq(publicPassports.id, row.id));
    await audit(tx, input.userId, row.id, "public_passport.fields_updated");
  });
}

export function checkBio(bio: string | null): string | null {
  const b = bio?.trim() || null;
  if (b && b.length > BIO_MAX) throw new PassportError("invalid", `Keep your bio under ${BIO_MAX} characters.`);
  if (b && restrictedTextKinds(b).length)
    throw new PassportError("invalid", "Leave out phone numbers, email addresses, tax IDs and bank details.");
  return b;
}

export async function updateBio(db: Database, input: { userId: string; bio: string | null }) {
  const bio = checkBio(input.bio);
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, input.userId);
    await tx
      .update(publicPassports)
      .set({ bio, ...bump(row) })
      .where(eq(publicPassports.id, row.id));
    await audit(tx, input.userId, row.id, "public_passport.bio_updated");
  });
}

export async function updateToggles(
  db: Database,
  input: { userId: string; indexable?: boolean; includePrivateInTotals?: boolean },
) {
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, input.userId);
    await tx
      .update(publicPassports)
      .set({
        ...(input.indexable === undefined ? {} : { indexable: input.indexable }),
        ...(input.includePrivateInTotals === undefined ? {} : { includePrivateInTotals: input.includePrivateInTotals }),
        ...bump(row),
      })
      .where(eq(publicPassports.id, row.id));
    await audit(tx, input.userId, row.id, "public_passport.options_updated", {
      ...(input.indexable === undefined ? {} : { indexable: input.indexable }),
      ...(input.includePrivateInTotals === undefined ? {} : { private_in_totals: input.includePrivateInTotals }),
    });
  });
}

/** Who may unlock (and discoverability). Needs `passport_unlock`, granted here if this is where the creator agreed. */
export async function setUnlockAudience(
  db: Database,
  input: {
    userId: string;
    audience: UnlockAudience;
    discoverable: boolean;
    consentDefinitionId?: string | null;
    source: ConsentSource;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (input.discoverable && input.audience !== "code_holders_and_verified_brands")
    throw new PassportError("invalid", "Discoverability needs verified brands in your audience.");
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, input.userId);
    await ensureSharingConsent(tx, {
      userId: input.userId,
      key: CONSENT_KEYS.passportUnlock,
      consentDefinitionId: input.consentDefinitionId,
      source: input.source,
      surface: "passport_sharing",
      metadata: { audience: input.audience, discoverable: input.discoverable },
      now,
    });
    await tx
      .update(publicPassports)
      .set({ audience: input.audience, discoverable: input.discoverable, ...bump(row) })
      .where(eq(publicPassports.id, row.id));
    await audit(tx, input.userId, row.id, "public_passport.audience_updated", {
      audience: input.audience,
      discoverable: input.discoverable,
    });
  });
}

// ── Link (slug) ─────────────────────────────────────────────────────────────

export function checkSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  const problem = slugProblem(slug);
  if (problem === "format")
    throw new PassportError(
      "invalid",
      "Use 3–30 lower-case letters, numbers and single hyphens, starting and ending with a letter or number.",
    );
  if (problem === "reserved") throw new PassportError("invalid", "That link is reserved. Try another.");
  if (problem === "restricted" || restrictedTextKinds(slug).length)
    throw new PassportError("invalid", "Links can't contain phone, account or ID numbers.");
  return slug;
}

export async function setSlug(db: Database, input: { userId: string; slug: string; now?: Date }) {
  const now = input.now ?? new Date();
  const slug = checkSlug(input.slug);
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, input.userId);
    if (row.slug === slug) return;
    const [takenByPassport] = await tx
      .select({ id: publicPassports.id })
      .from(publicPassports)
      .where(and(eq(publicPassports.slug, slug), ne(publicPassports.id, row.id)));
    const [takenByRedirect] = await tx
      .select({ passportId: publicPassportSlugRedirects.passportId })
      .from(publicPassportSlugRedirects)
      .where(and(eq(publicPassportSlugRedirects.slug, slug), gt(publicPassportSlugRedirects.expiresAt, now)));
    if (takenByPassport || (takenByRedirect && takenByRedirect.passportId !== row.id))
      throw new PassportError("slug_taken", "That link is taken. Try another.");
    // Taking back one of your own recent links: drop its redirect.
    await tx.delete(publicPassportSlugRedirects).where(eq(publicPassportSlugRedirects.slug, slug));
    if (row.slug && row.status === "published") {
      await tx
        .insert(publicPassportSlugRedirects)
        .values({
          slug: row.slug,
          passportId: row.id,
          expiresAt: new Date(now.getTime() + SLUG_REDIRECT_DAYS * 86_400_000),
        })
        .onConflictDoUpdate({
          target: publicPassportSlugRedirects.slug,
          set: { passportId: row.id, expiresAt: new Date(now.getTime() + SLUG_REDIRECT_DAYS * 86_400_000) },
        });
    }
    try {
      await tx
        .update(publicPassports)
        .set({ slug, ...bump(row) })
        .where(eq(publicPassports.id, row.id));
    } catch {
      throw new PassportError("slug_taken", "That link is taken. Try another.");
    }
    await audit(tx, input.userId, row.id, "public_passport.link_changed");
  });
}

// ── Publish ─────────────────────────────────────────────────────────────────

export async function publishPassport(
  db: Database,
  input: {
    userId: string;
    slug?: string | null;
    consentDefinitionId?: string | null;
    source: ConsentSource;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (!(await isFeatureEnabled(db, "public_passports")))
    throw new PassportError("feature_off", "Public passports are paused right now. Try again later.");
  if (input.slug) await setSlug(db, { userId: input.userId, slug: input.slug, now });
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, input.userId);
    if (!row.slug) throw new PassportError("invalid", "Choose a link first.");
    if (!(await hasVerifiedAccount(tx, row.creatorId)))
      throw new PassportError("not_eligible", "Connect and verify at least one social account first.");
    await ensureSharingConsent(tx, {
      userId: input.userId,
      key: CONSENT_KEYS.publicPassport,
      consentDefinitionId: input.consentDefinitionId,
      source: input.source,
      surface: "passport_sharing",
      metadata: { indexable: row.indexable },
      now,
    });
    if (row.status === "published") return;
    await tx
      .update(publicPassports)
      .set({ status: "published", publishedAt: now, unpublishedAt: null, ...bump(row) })
      .where(eq(publicPassports.id, row.id));
    await audit(tx, input.userId, row.id, "public_passport.published");
    await recordEvent(tx, { event: "passport_published", userId: input.userId, now });
  });
}

export async function unpublishPassport(
  db: DbExecutor,
  input: { userId: string; now?: Date; reason?: "creator" | "withdrawal" },
) {
  const now = input.now ?? new Date();
  const [row] = await db.select().from(publicPassports).where(eq(publicPassports.userId, input.userId)).for("update");
  if (!row || row.status !== "published") return false;
  await db
    .update(publicPassports)
    .set({ status: "unpublished", unpublishedAt: now, indexable: false, ...bump(row) })
    .where(eq(publicPassports.id, row.id));
  await audit(db, input.userId, row.id, "public_passport.unpublished", { reason: input.reason ?? "creator" });
  await recordEvent(db, { event: "passport_unpublished", userId: input.userId, now });
  return true;
}

export async function unpublishOwnPassport(db: Database, userId: string) {
  return db.transaction((tx) => unpublishPassport(tx, { userId }));
}

/** For the Passport home card and prompts: whether the passport is live, without creating a draft. */
export async function sharingSummary(db: DbExecutor, userId: string, now = new Date()) {
  const [row] = await db
    .select({ status: publicPassports.status, slug: publicPassports.slug })
    .from(publicPassports)
    .where(eq(publicPassports.userId, userId))
    .limit(1);
  const published =
    row?.status === "published" && (await hasValidConsent(db, userId, CONSENT_KEYS.publicPassport, now));
  return { published, slug: published ? (row?.slug ?? null) : null };
}
