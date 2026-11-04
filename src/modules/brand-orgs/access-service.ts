import { and, count, countDistinct, desc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { accessOpportunities, brandOrgs, brands, passportAccessLog, publicPassports } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordEvent } from "@/modules/analytics";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { isFeatureEnabled, platformLimit } from "@/modules/integrations/change-service";
import { indiaDayHour } from "@/modules/public-passport/codes-service";
import { isPassportLive, passportViewFor } from "@/modules/public-passport/page-service";
import type { PassportRow } from "@/modules/public-passport/settings-service";
import type { PublicPassportView } from "@/modules/public-passport/view";

import { BrandOrgError } from "./errors";
import { getMembership, type Membership } from "./org-service";

/**
 * Passport unlocks by verified brand and agency organisations (Stage 19).
 * A member of a VERIFIED organisation who accepted the brand terms can unlock
 * a passport whose creator chose "code holders and verified brands", or one
 * with an active code scoped to their organisation. Each organisation has a
 * daily quota (distinct passports, India day). The creator sees every unlock
 * with the organisation's name, marked verified.
 */

export type BrandReadiness =
  { ok: true; membership: Membership } | { ok: false; reason: "no_org" | "not_verified" | "terms" };

export async function brandReadiness(db: DbExecutor, userId: string): Promise<BrandReadiness> {
  const m = await getMembership(db, userId);
  if (!m) return { ok: false, reason: "no_org" };
  if (m.orgStatus !== "verified") return { ok: false, reason: "not_verified" };
  if (!m.termsAccepted) return { ok: false, reason: "terms" };
  return { ok: true, membership: m };
}

/**
 * Whether this organisation may unlock this passport as a verified brand right now: the creator chose "code holders
 * and verified brands", unlocking is consented and the switch is on. (A code the creator scoped to an organisation
 * is redeemed like any code, by a signed-in member of that organisation — see `redeemAccessCode`.)
 */
export async function orgMayUnlock(db: DbExecutor, input: { passport: PassportRow; orgId: string; now: Date }) {
  if (!(await isFeatureEnabled(db, "passport_brand_unlocks"))) return false;
  if (!(await hasValidConsent(db, input.passport.userId, CONSENT_KEYS.passportUnlock, input.now))) return false;
  return input.passport.audience === "code_holders_and_verified_brands";
}

/** An organisation's unlock of this passport today (India day) that still stands. */
export async function brandUnlockActive(db: DbExecutor, input: { passport: PassportRow; orgId: string; now: Date }) {
  const { day } = indiaDayHour(input.now);
  const [row] = await db
    .select({ id: passportAccessLog.id })
    .from(passportAccessLog)
    .where(
      and(
        eq(passportAccessLog.passportId, input.passport.id),
        eq(passportAccessLog.orgId, input.orgId),
        eq(passportAccessLog.kind, "brand"),
        eq(passportAccessLog.day, day),
      ),
    )
    .limit(1);
  return Boolean(row) && (await orgMayUnlock(db, input));
}

export async function orgDailyQuota(db: DbExecutor, orgId: string) {
  const [o] = await db.select({ quota: brandOrgs.dailyUnlockQuota }).from(brandOrgs).where(eq(brandOrgs.id, orgId));
  const limit = await platformLimit(db, "brand_unlock_daily_quota");
  return Math.min(o?.quota ?? limit, limit);
}

export async function orgUnlocksToday(db: DbExecutor, orgId: string, now: Date) {
  const { day } = indiaDayHour(now);
  const [row] = await db
    .select({ n: countDistinct(passportAccessLog.passportId) })
    .from(passportAccessLog)
    .where(
      and(eq(passportAccessLog.orgId, orgId), eq(passportAccessLog.kind, "brand"), eq(passportAccessLog.day, day)),
    );
  return Number(row?.n ?? 0);
}

/**
 * Unlocks a passport for the member's organisation for today. Re-opening a
 * passport already unlocked today doesn't use quota. The organisation row is
 * locked so two members can't race past the quota.
 */
export async function brandUnlock(
  db: Database,
  input: { userId: string; passportId: string; ipPseudonym: string | null; now?: Date },
): Promise<{ alreadyUnlocked: boolean }> {
  const now = input.now ?? new Date();
  const ready = await brandReadiness(db, input.userId);
  if (!ready.ok)
    throw new BrandOrgError(
      ready.reason === "terms" ? "terms_required" : "not_verified",
      ready.reason === "terms" ? "Accept the brand terms first." : "Your organisation isn't verified yet.",
    );
  const orgId = ready.membership.orgId;
  return db.transaction(async (tx) => {
    await tx.select({ id: brandOrgs.id }).from(brandOrgs).where(eq(brandOrgs.id, orgId)).for("update");
    const [passport] = await tx.select().from(publicPassports).where(eq(publicPassports.id, input.passportId));
    if (!passport || !(await isPassportLive(tx, passport, now))) throw new BrandOrgError("not_found");
    if (!(await orgMayUnlock(tx, { passport, orgId, now })))
      throw new BrandOrgError("forbidden", "This creator hasn't opened their Passport details to verified brands.");
    if (await brandUnlockActive(tx, { passport, orgId, now })) return { alreadyUnlocked: true };
    if ((await orgUnlocksToday(tx, orgId, now)) >= (await orgDailyQuota(tx, orgId)))
      throw new BrandOrgError("quota_exceeded", "Your organisation has used today's unlocks. Try again tomorrow.");
    await tx.insert(passportAccessLog).values({
      passportId: passport.id,
      kind: "brand",
      orgId,
      ipPseudonym: input.ipPseudonym,
      ...indiaDayHour(now),
    });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "public_passport.brand_unlocked",
      entityType: "public_passport",
      entityId: passport.id,
      metadata: { org: orgId },
    });
    return { alreadyUnlocked: false };
  });
}

/** The organisation's own unlock history (which passports, which day). */
export async function orgUnlockHistory(db: DbExecutor, orgId: string, limit = 100) {
  return db
    .select({ slug: publicPassports.slug, day: passportAccessLog.day, hour: passportAccessLog.hour })
    .from(passportAccessLog)
    .innerJoin(publicPassports, eq(publicPassports.id, passportAccessLog.passportId))
    .where(and(eq(passportAccessLog.orgId, orgId), eq(passportAccessLog.kind, "brand")))
    .orderBy(desc(passportAccessLog.createdAt))
    .limit(limit);
}

// ── Discovery (behind the /ops switch, off by default) ──────────────────────

export interface DiscoveryFilters {
  category?: string;
  platform?: string;
  followerBand?: string;
  industry?: string;
  city?: string;
}

/**
 * Creators who chose to be discoverable by verified brands. Results are built
 * from the PUBLIC tier only and filters only match public values, so a filter
 * can never reveal something the creator kept locked or hidden.
 */
export async function discoverCreators(
  db: Database,
  input: { userId: string; filters: DiscoveryFilters; now?: Date },
): Promise<{ slug: string; view: PublicPassportView }[]> {
  const now = input.now ?? new Date();
  if (!(await isFeatureEnabled(db, "brand_discovery")))
    throw new BrandOrgError("feature_off", "Discovery isn't available.");
  const ready = await brandReadiness(db, input.userId);
  if (!ready.ok) throw new BrandOrgError("not_verified", "Your organisation isn't verified yet.");
  const candidates = await db
    .select()
    .from(publicPassports)
    .where(
      and(
        eq(publicPassports.status, "published"),
        eq(publicPassports.discoverable, true),
        eq(publicPassports.audience, "code_holders_and_verified_brands"),
      ),
    )
    .orderBy(sql`${publicPassports.publishedAt} desc nulls last`)
    .limit(200);
  const out: { slug: string; view: PublicPassportView }[] = [];
  const f = input.filters;
  const norm = (s: string | undefined) => s?.trim().toLowerCase() || undefined;
  for (const p of candidates) {
    if (!p.slug || !(await isPassportLive(db, p, now))) continue;
    if (!(await hasValidConsent(db, p.userId, CONSENT_KEYS.passportUnlock, now))) continue;
    const view = await passportViewFor(db, p, "locked", now);
    if (!view) continue;
    const text = (field: string) =>
      view.sections
        .filter((s) => s.field === field && s.state === "shown")
        .flatMap((s) => (s.state === "shown" ? s.rows.map((r) => `${r.label} ${r.value}`) : []))
        .join(" ")
        .toLowerCase();
    if (norm(f.category) && !text("categories").includes(norm(f.category)!)) continue;
    if (norm(f.platform) && !text("handles").includes(norm(f.platform)!)) continue;
    if (norm(f.followerBand) && !text("follower_bands").includes(norm(f.followerBand)!)) continue;
    if (norm(f.industry) && !text("industries").includes(norm(f.industry)!)) continue;
    if (norm(f.city) && !text("city").includes(norm(f.city)!)) continue;
    out.push({ slug: p.slug, view });
    if (out.length >= 50) break;
  }
  await recordEvent(db, {
    event: "brand_discovery_searched",
    userId: input.userId,
    props: { filtered: Object.values(f).some((v) => typeof v === "string" && v.trim() !== "") },
    now,
  });
  return out;
}

export async function orgUnlockCountSince(db: DbExecutor, orgId: string, since: string) {
  const [r] = await db
    .select({ n: count() })
    .from(passportAccessLog)
    .where(and(eq(passportAccessLog.orgId, orgId), sql`${passportAccessLog.day} >= ${since}`));
  return Number(r?.n ?? 0);
}

/**
 * The Access-flow prompt: the verified organisation behind an opportunity's
 * brand (linked on the brand-org desk), or null. Lets a creator who asked for
 * access give that organisation alone a one-off code.
 */
export async function verifiedOrgForOpportunity(db: DbExecutor, opportunityId: string) {
  const [row] = await db
    .select({ id: brandOrgs.id, name: brandOrgs.legalName })
    .from(accessOpportunities)
    .innerJoin(brands, eq(brands.id, accessOpportunities.brandId))
    .innerJoin(brandOrgs, eq(brandOrgs.id, brands.brandOrgId))
    .where(and(eq(accessOpportunities.id, opportunityId), eq(brandOrgs.status, "verified")))
    .limit(1);
  return row ?? null;
}
