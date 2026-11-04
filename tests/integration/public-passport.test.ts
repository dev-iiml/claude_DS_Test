import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  analyticsEvents,
  auditEvents,
  brandOrgs,
  creatorSocialAccounts,
  featureSwitches,
  passportAccessCodes,
  passportAccessLog,
  publicPassports,
  users,
} from "@/db/schema";
import { brandUnlock, discoverCreators, orgUnlocksToday } from "@/modules/brand-orgs/access-service";
import { BrandOrgError } from "@/modules/brand-orgs/errors";
import { completeBrandSignup, requestBrandEmailCode } from "@/modules/brand-orgs/signup-service";
import {
  approveOrg,
  decideOrgAction,
  proposeOrgAction,
  runCompanyLookup,
  setOrgQuota,
  verifyOrg,
} from "@/modules/brand-orgs/review-service";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { withdrawPurpose } from "@/modules/privacy";
import { CODE_FAILURE_LIMIT } from "@/modules/public-passport/domain";
import {
  codeUnlockValid,
  createAccessCode,
  listAccessLog,
  redeemAccessCode,
  revokeAccessCode,
} from "@/modules/public-passport/codes-service";
import { PassportError } from "@/modules/public-passport/errors";
import { decideTakedown, reportPassport, takePassportOffline } from "@/modules/public-passport/moderation-service";
import { clearLockedCache, passportViewFor, resolvePassportSlug } from "@/modules/public-passport/page-service";
import {
  ensurePassport,
  publishPassport,
  setSlug,
  setUnlockAudience,
  updateFieldTiers,
} from "@/modules/public-passport/settings-service";
import { MockNotificationProvider } from "@/providers/notification/mock-notification-provider";
import { MOCK_OTP_CODE } from "@/providers/notification/mock-notification-provider";

import { authDepsFor, connectTestDb } from "../support/db";
import { completedMember, consentDef, staffUser } from "../support/members";

const { db } = connectTestDb();
const PUBLIC = consentDef(CONSENT_KEYS.publicPassport);
const UNLOCK = consentDef(CONSENT_KEYS.passportUnlock);
const notifications = new MockNotificationProvider();
let seq = 0;

/** A completed member whose declared Instagram account is connected (verified). */
async function verifiedMember() {
  const m = await completedMember(db);
  await db
    .update(creatorSocialAccounts)
    .set({ connectionStatus: "connected", connectedAt: new Date() })
    .where(eq(creatorSocialAccounts.creatorId, m.creatorId));
  return m;
}

async function published(opts: { unlock?: "code_holders_only" | "code_holders_and_verified_brands" } = {}) {
  const m = await verifiedMember();
  const slug = `pp-${Date.now().toString(36)}-${++seq}`;
  await publishPassport(db, { userId: m.userId, slug, consentDefinitionId: PUBLIC, source: "settings" });
  if (opts.unlock)
    await setUnlockAudience(db, {
      userId: m.userId,
      audience: opts.unlock,
      discoverable: false,
      consentDefinitionId: UNLOCK,
      source: "settings",
    });
  const passport = await ensurePassport(db, m.userId);
  return { ...m, slug, passport };
}

async function verifiedOrg(opts: { domain?: string } = {}) {
  const domain = opts.domain ?? `org${Date.now().toString(36)}${++seq}.example`;
  const { challengeId } = await requestBrandEmailCode({ db, notifications }, { email: `owner@${domain}` });
  const cin = `U74999ZZ2020PTC${String(100000 + Math.floor(Math.random() * 899999))}`;
  const r = await completeBrandSignup(
    { auth: authDepsFor(db) },
    {
      challengeId,
      code: MOCK_OTP_CODE,
      password: "Str0ng!passphrase",
      legalName: `Lumen Test ${seq} Private Limited`,
      orgType: "brand",
      website: `https://${domain}`,
      identifierType: "cin",
      identifierValue: cin,
      gstin: undefined,
      acceptTerms: true,
    },
  );
  const a = await staffUser(db, "partnerships_admin");
  const b = await staffUser(db, "partnerships_admin");
  await runCompanyLookup(db, { staffId: a, orgId: r.orgId, production: false });
  await verifyOrg(db, { staffId: a, orgId: r.orgId });
  await approveOrg(db, { staffId: b, orgId: r.orgId });
  return { ...r, staffA: a, staffB: b };
}

describe("publishing (Stage 19)", () => {
  it("needs a connected account and its own consent, then serves the page", async () => {
    const m = await completedMember(db);
    await expect(
      publishPassport(db, { userId: m.userId, slug: `pp-x${++seq}`, consentDefinitionId: PUBLIC, source: "settings" }),
    ).rejects.toMatchObject({ code: "not_eligible" });
    await db
      .update(creatorSocialAccounts)
      .set({ connectionStatus: "connected", connectedAt: new Date() })
      .where(eq(creatorSocialAccounts.creatorId, m.creatorId));
    await expect(
      publishPassport(db, { userId: m.userId, slug: `pp-y${++seq}`, source: "settings" }),
    ).rejects.toMatchObject({ code: "consent_required" });
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.publicPassport)).toBe(false);

    const slug = `pp-z${++seq}`;
    await publishPassport(db, { userId: m.userId, slug, consentDefinitionId: PUBLIC, source: "settings" });
    const r = await resolvePassportSlug(db, slug);
    expect(r.kind).toBe("live");
    // Unlocking is a separate consent, not granted by publishing.
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.passportUnlock)).toBe(false);
  });

  it("refuses reserved and taken links; a changed link forwards for 30 days", async () => {
    const a = await published();
    const b = await verifiedMember();
    await expect(setSlug(db, { userId: b.userId, slug: "admin" })).rejects.toBeInstanceOf(PassportError);
    await expect(setSlug(db, { userId: b.userId, slug: a.slug })).rejects.toMatchObject({ code: "slug_taken" });
    const next = `${a.slug}-new`;
    await setSlug(db, { userId: a.userId, slug: next });
    expect(await resolvePassportSlug(db, a.slug)).toEqual({ kind: "redirect", slug: next });
    expect((await resolvePassportSlug(db, a.slug, new Date(Date.now() + 31 * 86_400_000))).kind).toBe("gone");
    // The old link stays reserved for its owner while it forwards.
    await expect(setSlug(db, { userId: b.userId, slug: a.slug })).rejects.toMatchObject({ code: "slug_taken" });
  });

  it("unknown and offline links answer the same way", async () => {
    expect((await resolvePassportSlug(db, "no-such-passport-anywhere")).kind).toBe("gone");
    const p = await published();
    const staff = await staffUser(db, "partnerships_admin");
    await takePassportOffline(db, { staffId: staff, passportId: p.passport.id, reason: "impersonation" });
    expect((await resolvePassportSlug(db, p.slug)).kind).toBe("gone");
  });

  it("locked views never carry locked values; changes bump the cache version", async () => {
    const p = await published();
    await updateFieldTiers(db, { userId: p.userId, tiers: { handles: "unlocked" } });
    const fresh = await ensurePassport(db, p.userId);
    expect(fresh.cacheVersion).toBeGreaterThan(p.passport.cacheVersion);
    clearLockedCache();
    const locked = await passportViewFor(db, fresh, "locked");
    expect(JSON.stringify(locked)).not.toContain(p.handle);
    const unlocked = await passportViewFor(db, fresh, "unlocked");
    expect(JSON.stringify(unlocked)).toContain(p.handle);
  });
});

describe("access codes", () => {
  it("need the unlock consent; redeem once, log a pseudonymous entry, then revoke", async () => {
    const p = await published();
    await expect(createAccessCode(db, { userId: p.userId, label: "Agency", expiresInDays: 30 })).rejects.toMatchObject({
      code: "consent_required",
    });
    await setUnlockAudience(db, {
      userId: p.userId,
      audience: "code_holders_only",
      discoverable: false,
      consentDefinitionId: UNLOCK,
      source: "settings",
    });
    const c = await createAccessCode(db, { userId: p.userId, label: "Agency pitch", expiresInDays: 30, maxUses: 2 });
    const [stored] = await db.select().from(passportAccessCodes).where(eq(passportAccessCodes.id, c.id));
    expect(JSON.stringify(stored)).not.toContain(c.code);

    const r = await redeemAccessCode(db, {
      passportId: p.passport.id,
      code: c.display.toLowerCase(),
      viewerName: "Asha",
      viewerCompany: "Lumen",
      ipPseudonym: "ip1:" + "a".repeat(32),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      await codeUnlockValid(db, { passportId: p.passport.id, userId: p.userId, codeId: r.codeId, now: new Date() }),
    ).toBe(true);
    const log = await listAccessLog(db, p.userId);
    expect(log[0]).toMatchObject({
      kind: "code",
      codeLabel: "Agency pitch",
      viewerName: "Asha",
      viewerCompany: "Lumen",
    });
    expect(log[0]!.hour).toBeGreaterThanOrEqual(0);

    // Max uses.
    expect((await redeemAccessCode(db, { passportId: p.passport.id, code: c.code, ipPseudonym: null })).ok).toBe(true);
    expect(await redeemAccessCode(db, { passportId: p.passport.id, code: c.code, ipPseudonym: null })).toEqual({
      ok: false,
      reason: "expired",
    });

    const c2 = await createAccessCode(db, { userId: p.userId, label: "Second", expiresInDays: 7 });
    const r2 = await redeemAccessCode(db, { passportId: p.passport.id, code: c2.code, ipPseudonym: null });
    await revokeAccessCode(db, { userId: p.userId, codeId: c2.id });
    if (r2.ok)
      expect(
        await codeUnlockValid(db, { passportId: p.passport.id, userId: p.userId, codeId: r2.codeId, now: new Date() }),
      ).toBe(false);
  });

  it("expires codes, and a code from another passport does nothing", async () => {
    const p = await published({ unlock: "code_holders_only" });
    const q = await published({ unlock: "code_holders_only" });
    const c = await createAccessCode(db, { userId: p.userId, label: "Week", expiresInDays: 7 });
    expect((await redeemAccessCode(db, { passportId: q.passport.id, code: c.code, ipPseudonym: null })).ok).toBe(false);
    expect(
      await redeemAccessCode(db, {
        passportId: p.passport.id,
        code: c.code,
        ipPseudonym: null,
        now: new Date(Date.now() + 8 * 86_400_000),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("tells the creator about a burst of wrong codes, without blocking real code holders", async () => {
    const p = await published({ unlock: "code_holders_only" });
    const c = await createAccessCode(db, { userId: p.userId, label: "Real", expiresInDays: 7 });
    for (let i = 0; i < CODE_FAILURE_LIMIT; i++)
      expect(
        await redeemAccessCode(db, { passportId: p.passport.id, code: "AAAA-BBBB-CCCC-DDDD", ipPseudonym: null }),
      ).toEqual({ ok: false, reason: "wrong" });
    const log = await listAccessLog(db, p.userId);
    expect(log.filter((l) => l.kind === "lockout")).toHaveLength(1);
    // More wrong codes in the same window don't notify again; a real code still works.
    await redeemAccessCode(db, { passportId: p.passport.id, code: "AAAA-BBBB-CCCC-DDDE", ipPseudonym: null });
    expect((await listAccessLog(db, p.userId)).filter((l) => l.kind === "lockout")).toHaveLength(1);
    expect((await redeemAccessCode(db, { passportId: p.passport.id, code: c.code, ipPseudonym: null })).ok).toBe(true);
  });

  it("an organisation-scoped code works only for that organisation", async () => {
    const p = await published({ unlock: "code_holders_only" });
    const org = await verifiedOrg();
    const c = await createAccessCode(db, { userId: p.userId, label: "For Lumen", expiresInDays: 7, orgId: org.orgId });
    expect((await redeemAccessCode(db, { passportId: p.passport.id, code: c.code, ipPseudonym: null })).ok).toBe(false);
    const r = await redeemAccessCode(db, {
      passportId: p.passport.id,
      code: c.code,
      viewerOrgId: org.orgId,
      ipPseudonym: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const check = (viewerOrgId: string | null) =>
      codeUnlockValid(db, {
        passportId: p.passport.id,
        userId: p.userId,
        codeId: r.codeId,
        now: new Date(),
        viewerOrgId,
      });
    expect(await check(org.orgId)).toBe(true);
    expect(await check(null)).toBe(false);
    // Holding a scoped code isn't a brand unlock: the creator's audience is still code holders only.
    await expect(
      brandUnlock(db, { userId: org.userId, passportId: p.passport.id, ipPseudonym: null }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    // Suspending the organisation ends access through the code too.
    await proposeOrgAction(db, { staffId: org.staffA, orgId: org.orgId, action: "suspend", reason: "terms_breach" });
    await decideOrgAction(db, { staffId: org.staffB, orgId: org.orgId, approve: true });
    expect(await check(org.orgId)).toBe(false);
  });
});

describe("withdrawals", () => {
  it("public_passport → gone at once, indexing off, codes revoked (re-publishing doesn't bring them back)", async () => {
    const p = await published({ unlock: "code_holders_only" });
    const c = await createAccessCode(db, { userId: p.userId, label: "Any", expiresInDays: 7 });
    await withdrawPurpose({ db }, { userId: p.userId, key: CONSENT_KEYS.publicPassport, source: "settings" });
    expect((await resolvePassportSlug(db, p.slug)).kind).toBe("gone");
    const row = await ensurePassport(db, p.userId);
    expect(row.status).toBe("unpublished");
    expect(row.indexable).toBe(false);
    expect((await redeemAccessCode(db, { passportId: p.passport.id, code: c.code, ipPseudonym: null })).ok).toBe(false);
    const [code] = await db.select().from(passportAccessCodes).where(eq(passportAccessCodes.id, c.id));
    expect(code!.revokedAt).not.toBeNull();
  });

  it("passport_unlock → codes revoked, brands lose access, the access log is kept", async () => {
    const p = await published({ unlock: "code_holders_and_verified_brands" });
    const c = await createAccessCode(db, { userId: p.userId, label: "Keep log", expiresInDays: 7 });
    expect((await redeemAccessCode(db, { passportId: p.passport.id, code: c.code, ipPseudonym: null })).ok).toBe(true);
    await withdrawPurpose({ db }, { userId: p.userId, key: CONSENT_KEYS.passportUnlock, source: "settings" });
    const [code] = await db.select().from(passportAccessCodes).where(eq(passportAccessCodes.id, c.id));
    expect(code!.revokedAt).not.toBeNull();
    const row = await ensurePassport(db, p.userId);
    expect(row.audience).toBe("code_holders_only");
    expect((await listAccessLog(db, p.userId)).length).toBeGreaterThan(0);
    // The public page itself stays up.
    expect((await resolvePassportSlug(db, p.slug)).kind).toBe("live");
  });
});

describe("brand organisations", () => {
  it("refuses free-mail sign-ups and never stores, logs or audits a GSTIN", async () => {
    await expect(requestBrandEmailCode({ db, notifications }, { email: "someone@gmail.com" })).rejects.toMatchObject({
      code: "free_mail",
    });
    const domain = `gst${Date.now().toString(36)}.example`;
    const { challengeId } = await requestBrandEmailCode({ db, notifications }, { email: `owner@${domain}` });
    const gstin = "08AAPCA1234B1Z9";
    const r = await completeBrandSignup(
      { auth: authDepsFor(db) },
      {
        challengeId,
        code: MOCK_OTP_CODE,
        password: "Str0ng!passphrase",
        legalName: "Gst Test Private Limited",
        orgType: "agency",
        website: `https://${domain}`,
        identifierType: "llpin",
        identifierValue: `AA${String.fromCharCode(65 + (seq % 26))}-${String(1000 + (++seq % 8999))}`,
        gstin,
        acceptTerms: true,
      },
    );
    const [org] = await db.select().from(brandOrgs).where(eq(brandOrgs.id, r.orgId));
    expect(JSON.stringify(org)).not.toContain(gstin);
    expect(org!.gstinFingerprint).toMatch(/^g1:/);
    expect(org!.gstinStateCode).toBe("08");
    const audits = await db
      .select({ m: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, r.orgId));
    expect(JSON.stringify(audits)).not.toContain(gstin);
    const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, r.userId));
    expect(u!.role).toBe("brand_member");
  });

  it("four eyes: the checker can't approve, and a lookup comes first", async () => {
    const domain = `four${Date.now().toString(36)}.example`;
    const { challengeId } = await requestBrandEmailCode({ db, notifications }, { email: `owner@${domain}` });
    const r = await completeBrandSignup(
      { auth: authDepsFor(db) },
      {
        challengeId,
        code: MOCK_OTP_CODE,
        password: "Str0ng!passphrase",
        legalName: "Four Eyes Private Limited",
        orgType: "brand",
        website: `https://${domain}`,
        identifierType: "cin",
        identifierValue: `U74999ZZ2021PTC${String(100000 + ++seq)}`,
        gstin: undefined,
        acceptTerms: true,
      },
    );
    const a = await staffUser(db, "partnerships_admin");
    await expect(verifyOrg(db, { staffId: a, orgId: r.orgId })).rejects.toBeInstanceOf(BrandOrgError);
    await runCompanyLookup(db, { staffId: a, orgId: r.orgId, production: false });
    await verifyOrg(db, { staffId: a, orgId: r.orgId });
    await expect(approveOrg(db, { staffId: a, orgId: r.orgId })).rejects.toMatchObject({ code: "four_eyes" });
    await expect(
      db.update(brandOrgs).set({ status: "verified", approvedBy: a }).where(eq(brandOrgs.id, r.orgId)),
    ).rejects.toThrow();
  });

  it("unlocks only where the creator allowed verified brands, within the daily quota, logged with the org", async () => {
    const org = await verifiedOrg();
    const closed = await published({ unlock: "code_holders_only" });
    await expect(
      brandUnlock(db, { userId: org.userId, passportId: closed.passport.id, ipPseudonym: null }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const open = await published({ unlock: "code_holders_and_verified_brands" });
    expect(await brandUnlock(db, { userId: org.userId, passportId: open.passport.id, ipPseudonym: null })).toEqual({
      alreadyUnlocked: false,
    });
    expect(await brandUnlock(db, { userId: org.userId, passportId: open.passport.id, ipPseudonym: null })).toEqual({
      alreadyUnlocked: true,
    });
    expect(await orgUnlocksToday(db, org.orgId, new Date())).toBe(1);
    const log = await listAccessLog(db, open.userId);
    expect(log[0]).toMatchObject({ kind: "brand", orgVerified: true });
    expect(log[0]!.orgName).toContain("Lumen Test");

    await setOrgQuota(db, { staffId: org.staffA, orgId: org.orgId, quota: 1 });
    const another = await published({ unlock: "code_holders_and_verified_brands" });
    await expect(
      brandUnlock(db, { userId: org.userId, passportId: another.passport.id, ipPseudonym: null }),
    ).rejects.toMatchObject({ code: "quota_exceeded" });
  });

  it("a suspended organisation can't unlock (suspension is four eyes)", async () => {
    const org = await verifiedOrg();
    const p = await published({ unlock: "code_holders_and_verified_brands" });
    await proposeOrgAction(db, { staffId: org.staffA, orgId: org.orgId, action: "suspend", reason: "terms_breach" });
    await expect(decideOrgAction(db, { staffId: org.staffA, orgId: org.orgId, approve: true })).rejects.toMatchObject({
      code: "four_eyes",
    });
    await decideOrgAction(db, { staffId: org.staffB, orgId: org.orgId, approve: true });
    await expect(
      brandUnlock(db, { userId: org.userId, passportId: p.passport.id, ipPseudonym: null }),
    ).rejects.toBeInstanceOf(BrandOrgError);
  });

  it("discovery is off by default and, when on, returns the public tier of discoverable passports only", async () => {
    const org = await verifiedOrg();
    await expect(discoverCreators(db, { userId: org.userId, filters: {} })).rejects.toMatchObject({
      code: "feature_off",
    });
    const p = await published({ unlock: "code_holders_and_verified_brands" });
    await setUnlockAudience(db, {
      userId: p.userId,
      audience: "code_holders_and_verified_brands",
      discoverable: true,
      source: "settings",
    });
    await db
      .insert(featureSwitches)
      .values({ key: "brand_discovery", enabled: true })
      .onConflictDoUpdate({ target: featureSwitches.key, set: { enabled: true } });
    try {
      const results = await discoverCreators(db, { userId: org.userId, filters: {} });
      const mine = results.find((r) => r.slug === p.slug);
      expect(mine).toBeDefined();
      expect(mine!.view.access).toBe("locked");
    } finally {
      await db.update(featureSwitches).set({ enabled: false }).where(eq(featureSwitches.key, "brand_discovery"));
    }
  });
});

describe("moderation", () => {
  it("reports carry ids only; making a takedown permanent needs a second admin", async () => {
    const p = await published();
    await reportPassport(db, { passportId: p.passport.id, reason: "impersonation" });
    const a = await staffUser(db, "partnerships_admin");
    const b = await staffUser(db, "partnerships_admin");
    await takePassportOffline(db, { staffId: a, passportId: p.passport.id, reason: "impersonation" });
    const [t] = await db.execute<{ id: string }>(
      sql`select id from passport_takedowns where passport_id = ${p.passport.id}`,
    );
    await decideTakedown(db, { staffId: a, takedownId: t!.id, step: "propose_permanent" });
    await expect(
      decideTakedown(db, { staffId: a, takedownId: t!.id, step: "approve_permanent" }),
    ).rejects.toMatchObject({ code: "four_eyes" });
    await decideTakedown(db, { staffId: b, takedownId: t!.id, step: "approve_permanent" });
    expect((await resolvePassportSlug(db, p.slug)).kind).toBe("gone");
  });
});

describe("analytics", () => {
  it("records publish and unlock events without personal data", async () => {
    const p = await published({ unlock: "code_holders_only" });
    const c = await createAccessCode(db, { userId: p.userId, label: "Events", expiresInDays: 7 });
    await redeemAccessCode(db, { passportId: p.passport.id, code: c.code, viewerName: "Asha Rao", ipPseudonym: null });
    const rows = await db
      .select()
      .from(analyticsEvents)
      .where(sql`${analyticsEvents.event} like 'passport_%'`);
    const events = new Set(rows.map((r) => r.event));
    for (const e of ["passport_published", "passport_code_created", "passport_unlock_attempted"])
      expect(events).toContain(e);
    expect(JSON.stringify(rows)).not.toContain("Asha");
    expect(JSON.stringify(rows)).not.toContain(p.slug);
  });
});

// Keep the brand-unlock log table referenced so a rename shows up here.
void passportAccessLog;
void publicPassports;
