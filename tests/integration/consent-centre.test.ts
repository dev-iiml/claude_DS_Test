import { and, count, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  consentWithdrawals,
  creatorProfessionalFeatures,
  creatorProfiles,
  creatorSocialAccounts,
  creatorSocialSnapshots,
  dataErasureRequests,
  identityLookupResults,
  professionalGraphRuns,
} from "@/db/schema";
import { CONSENT_KEYS, grantConsent, hasValidConsent } from "@/modules/consent";
import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import {
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { getPassport } from "@/modules/passport/passport-view";
import {
  getConsentCentre,
  getReceipt,
  grantPurpose,
  noRetentionHolds,
  processDeferredErasures,
  withdrawPurpose,
  type RetentionHoldChecker,
} from "@/modules/privacy";
import { getLatestProfessionalGraph, runProfessionalGraph } from "@/modules/professional-graph/graph-service";
import { completeConnection, startConnection } from "@/modules/social-data/connection-service";
import { MockSocialDataProvider, encodeMockCode } from "@/providers/social/mock-social-data-provider";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const def = (key: string) => CONSENT_DEFINITION_SEEDS.find((d) => d.key === key)!.id;
const social = () => ({ db, social: new MockSocialDataProvider() });

async function member(handle: string) {
  const r = await signUpCreator(auth, { email: testEmail("privacy"), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Tara Bose",
      displayName: "Tara Talks",
      city: "Kolkata",
      state: "West Bengal",
      languages: ["bn"],
    }),
  );
  await saveProfileStep(
    db,
    userId,
    profileStepSchema.parse({
      primaryCreatorHandle: handle,
      categories: ["education"],
      primaryCategory: "education",
      creatorSince: "2020-01",
      platforms: ["instagram"],
    }),
  );
  await saveBusinessStep(
    db,
    userId,
    businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" }),
  );
  await saveInterestsStep(db, userId, {
    prInterest: false,
    preferredCategories: [],
    brandInterests: [],
    travelInterest: false,
  });
  await completeOnboarding(db, userId, { consentDefinitionId: def(CONSENT_KEYS.creatorProfile) });
  const [p] = await db
    .select({ id: creatorProfiles.id })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId));
  return { userId, creatorId: p!.id };
}

/** A member with Instagram connected and professional signals on. */
async function connectedMember(handle: string) {
  const m = await member(handle);
  const { authorizationUrl } = await startConnection(social(), {
    userId: m.userId,
    platform: "instagram",
    redirectUri: "http://localhost/cb",
    connectionConsentId: def(CONSENT_KEYS.socialAccountConnection),
    analyticsConsentId: def(CONSENT_KEYS.professionalAnalytics),
  });
  const state = new URL(authorizationUrl, "http://x").searchParams.get("state")!;
  const r = await completeConnection(social(), {
    userId: m.userId,
    state,
    code: encodeMockCode({ platform: "instagram", handle, nonce: "n" }),
  });
  return { ...m, accountId: r.accountId };
}

const snapshotCount = async (accountId: string) =>
  (
    await db
      .select({ n: count() })
      .from(creatorSocialSnapshots)
      .where(eq(creatorSocialSnapshots.socialAccountId, accountId))
  )[0]!.n;
const runCount = async (creatorId: string) =>
  (
    await db.select({ n: count() }).from(professionalGraphRuns).where(eq(professionalGraphRuns.creatorId, creatorId))
  )[0]!.n;

const statusOf = async (userId: string, key: string) =>
  (await getConsentCentre(db, userId)).find((p) => p.policy.key === key)!.status;

describe("consent centre read model", () => {
  it("lists every purpose with status, current text and receipts", async () => {
    const m = await connectedMember("tara.centre.test");
    const centre = await getConsentCentre(db, m.userId);
    expect(centre.map((p) => [p.policy.key, p.status])).toEqual([
      ["creator_profile", "on"],
      ["identity_prefill", "never"],
      ["social_account_connection", "on"],
      ["professional_analytics", "on"],
      ["financial_eligibility", "never"],
      ["lender_sharing", "never"],
      ["lender_handoff", "never"],
      ["brand_opportunities", "never"],
    ]);
    const profile = centre[0]!;
    expect(profile.current).toMatchObject({ version: 1 });
    expect(profile.receipts).toHaveLength(1);

    const receipt = await getReceipt(db, { userId: m.userId, receiptId: profile.receipts[0]!.id });
    expect(receipt).toMatchObject({ key: "creator_profile", version: 1, status: "granted", source: "onboarding" });
    expect(receipt!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const other = await member("someone.else.centre");
    expect(await getReceipt(db, { userId: other.userId, receiptId: profile.receipts[0]!.id })).toBeNull();
  });
});

describe("withdrawing social account connection", () => {
  it("disconnects, erases snapshots and signals, then recomputes signals without them", async () => {
    const m = await connectedMember("tara.social.test");
    expect(await snapshotCount(m.accountId)).toBe(12);
    const before = await getLatestProfessionalGraph(db, m.creatorId);
    expect(before!.features.find((f) => f.key === "connected_platforms")!.value).toBe(1);

    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.socialAccountConnection, reason: "privacy", source: "settings" },
    );
    expect(result.effects).toEqual({ accounts_disconnected: 1 });
    expect(result.erasures).toEqual([
      { scope: "social_account_data", status: "completed", holdReasons: [] },
      { scope: "professional_graph", status: "completed", holdReasons: [] },
    ]);
    expect(result.graphRecomputed).toBe(true);

    const [row] = await db.select().from(creatorSocialAccounts).where(eq(creatorSocialAccounts.id, m.accountId));
    expect(row).toMatchObject({
      connectionStatus: "declared",
      provider: "self_declared",
      externalAccountId: null,
      accountCreatedAt: null,
    });
    expect(await snapshotCount(m.accountId)).toBe(0);
    const after = await getLatestProfessionalGraph(db, m.creatorId);
    expect(after!.runId).not.toBe(before!.runId);
    expect(after!.features.find((f) => f.key === "connected_platforms")!.value).toBe(0);
    expect(await runCount(m.creatorId)).toBe(1); // old runs erased, one fresh run

    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.socialAccountConnection)).toBe(false);
    expect(await statusOf(m.userId, CONSENT_KEYS.socialAccountConnection)).toBe("off");

    const [w] = await db.select().from(consentWithdrawals).where(eq(consentWithdrawals.id, result.withdrawalId));
    expect(w).toMatchObject({
      consentKey: "social_account_connection",
      definitionVersion: 1,
      reason: "privacy",
      source: "settings",
    });
    const erasures = await db
      .select()
      .from(dataErasureRequests)
      .where(eq(dataErasureRequests.withdrawalId, result.withdrawalId));
    expect(erasures.find((e) => e.scope === "social_account_data")!.erased).toMatchObject({ snapshots: 12 });

    await expect(
      withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.socialAccountConnection, source: "settings" }),
    ).rejects.toMatchObject({ code: "not_granted" });
  });

  it("keeps withdrawals append-only", async () => {
    const [any] = await db.select({ id: consentWithdrawals.id }).from(consentWithdrawals).limit(1);
    await expect(
      db.update(consentWithdrawals).set({ reason: "other" }).where(eq(consentWithdrawals.id, any!.id)),
    ).rejects.toThrow();
    await expect(db.delete(consentWithdrawals).where(eq(consentWithdrawals.id, any!.id))).rejects.toThrow();
  });
});

describe("withdrawing professional analytics", () => {
  it("stops computing and erases computed signals", async () => {
    const m = await connectedMember("tara.signals.test");
    const graph = await getLatestProfessionalGraph(db, m.creatorId);
    await withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.professionalAnalytics, source: "settings" });
    expect(await runCount(m.creatorId)).toBe(0);
    expect(
      (
        await db
          .select({ n: count() })
          .from(creatorProfessionalFeatures)
          .where(eq(creatorProfessionalFeatures.runId, graph!.runId))
      )[0]!.n,
    ).toBe(0);
    expect((await getPassport(db, m.userId))!.graph).toBeNull();
    // Social data itself is untouched: that's a different purpose.
    expect(await snapshotCount(m.accountId)).toBe(12);

    // Turning it back on computes again.
    await grantPurpose(
      { db },
      {
        userId: m.userId,
        key: CONSENT_KEYS.professionalAnalytics,
        consentDefinitionId: def(CONSENT_KEYS.professionalAnalytics),
        source: "settings",
      },
    );
    expect(await runCount(m.creatorId)).toBe(1);
    const centre = (await getConsentCentre(db, m.userId)).find(
      (p) => p.policy.key === CONSENT_KEYS.professionalAnalytics,
    )!;
    expect(centre.receipts.map((r) => r.status)).toEqual(["granted", "withdrawn"]);
  });

  it("still blocks deleting graph rows outside an erasure", async () => {
    const m = await connectedMember("tara.guard.test");
    await expect(
      db.delete(professionalGraphRuns).where(eq(professionalGraphRuns.creatorId, m.creatorId)),
    ).rejects.toThrow();
    // A stray setting outside a transaction does not leak into later statements.
    await db.execute(sql`select set_config('creatorco.erasure', 'on', true)`);
    await expect(
      db.delete(professionalGraphRuns).where(eq(professionalGraphRuns.creatorId, m.creatorId)),
    ).rejects.toThrow();
  });
});

describe("retention holds (credit relationships)", () => {
  const creditHold: RetentionHoldChecker = {
    async holdsFor(_db, { scope }) {
      return scope === "social_account_data" ? ["credit_facility_active"] : [];
    },
  };

  it("stops processing at once but defers erasure until the hold lifts", async () => {
    const m = await connectedMember("tara.hold.test");
    const result = await withdrawPurpose(
      { db, holds: creditHold },
      { userId: m.userId, key: CONSENT_KEYS.socialAccountConnection, source: "settings" },
    );
    expect(result.erasures).toEqual([
      { scope: "social_account_data", status: "deferred", holdReasons: ["credit_facility_active"] },
      { scope: "professional_graph", status: "completed", holdReasons: [] },
    ]);
    // Processing stopped…
    const [row] = await db.select().from(creatorSocialAccounts).where(eq(creatorSocialAccounts.id, m.accountId));
    expect(row!.connectionStatus).toBe("declared");
    // …but held data is retained.
    expect(await snapshotCount(m.accountId)).toBe(12);
    const view = (await getConsentCentre(db, m.userId)).find(
      (p) => p.policy.key === CONSENT_KEYS.socialAccountConnection,
    )!;
    expect(view.deferredErasures).toMatchObject([
      { scope: "social_account_data", holdReasons: ["credit_facility_active"] },
    ]);

    // Hold still in place: nothing happens.
    await processDeferredErasures({ db, holds: creditHold });
    const held = await db
      .select({ status: dataErasureRequests.status })
      .from(dataErasureRequests)
      .where(
        and(
          eq(dataErasureRequests.withdrawalId, result.withdrawalId),
          eq(dataErasureRequests.scope, "social_account_data"),
        ),
      );
    expect(held).toEqual([{ status: "deferred" }]);
    expect(await snapshotCount(m.accountId)).toBe(12);
    // Hold lifted: erased.
    await processDeferredErasures({ db, holds: noRetentionHolds });
    expect(await snapshotCount(m.accountId)).toBe(0);
    const [req] = await db
      .select()
      .from(dataErasureRequests)
      .where(
        and(
          eq(dataErasureRequests.withdrawalId, result.withdrawalId),
          eq(dataErasureRequests.scope, "social_account_data"),
        ),
      );
    expect(req).toMatchObject({ status: "completed", erased: { snapshots: 12 } });

    // Only deferred → completed is allowed.
    await expect(
      db
        .update(dataErasureRequests)
        .set({ status: "deferred", completedAt: null })
        .where(eq(dataErasureRequests.id, req!.id)),
    ).rejects.toThrow();
    await expect(db.delete(dataErasureRequests).where(eq(dataErasureRequests.id, req!.id))).rejects.toThrow();
  });
});

describe("withdrawing the Creator Profile consent", () => {
  it("pauses membership, stops processing, and resumes on re-consent", async () => {
    const m = await connectedMember("tara.pause.test");
    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.creatorProfile, source: "settings" },
    );
    expect(result.effects).toEqual({ membership_paused: true, access_requests_cancelled: 0 });

    const [p] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.id, m.creatorId));
    expect(p).toMatchObject({ profileStatus: "paused" });
    expect(p!.pausedAt).not.toBeNull();
    expect(await getPassport(db, m.userId)).toBeNull();
    expect(await runProfessionalGraph(db, { userId: m.userId, creatorId: m.creatorId, trigger: "manual" })).toEqual({
      ok: false,
      reason: "profile_inactive",
    });
    await expect(
      startConnection(social(), {
        userId: m.userId,
        platform: "youtube",
        redirectUri: "http://localhost/cb",
        connectionConsentId: def(CONSENT_KEYS.socialAccountConnection),
      }),
    ).rejects.toMatchObject({ code: "profile_incomplete" });
    // Data is kept while paused.
    expect(await snapshotCount(m.accountId)).toBe(12);

    await grantPurpose(
      { db },
      {
        userId: m.userId,
        key: CONSENT_KEYS.creatorProfile,
        consentDefinitionId: def(CONSENT_KEYS.creatorProfile),
        source: "settings",
      },
    );
    const [resumed] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.id, m.creatorId));
    expect(resumed).toMatchObject({ profileStatus: "completed", pausedAt: null });
    expect(await getPassport(db, m.userId)).not.toBeNull();
  });

  it("is not available to draft creators from the consent centre", async () => {
    const r = await signUpCreator(auth, { email: testEmail("draft"), password: "a long enough passphrase" });
    if (!r.ok) throw new Error("signup failed");
    await expect(
      grantPurpose(
        { db },
        {
          userId: r.user.userId,
          key: CONSENT_KEYS.creatorProfile,
          consentDefinitionId: def(CONSENT_KEYS.creatorProfile),
          source: "settings",
        },
      ),
    ).rejects.toMatchObject({ code: "profile_required" });
  });
});

describe("withdrawing identity verification", () => {
  it("erases lookup results and marks the legal name self-declared", async () => {
    const m = await member("tara.identity.test");
    const receipt = await grantConsent(db, {
      userId: m.userId,
      key: CONSENT_KEYS.identityPrefill,
      consentDefinitionId: def(CONSENT_KEYS.identityPrefill),
      source: "onboarding",
    });
    await db.insert(identityLookupResults).values({
      userId: m.userId,
      mobile: "9000000004",
      verifiedName: "Tara Bose",
      panMasked: "XXXXX1234A",
      provider: "mock",
      consentReceiptId: receipt.id,
      fetchedAt: new Date(),
    });
    await db
      .update(creatorProfiles)
      .set({ legalNameSource: "verified_lookup" })
      .where(eq(creatorProfiles.id, m.creatorId));

    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.identityPrefill, source: "settings" },
    );
    expect(result.erasures).toEqual([{ scope: "identity_lookup", status: "completed", holdReasons: [] }]);
    expect(
      await db.select().from(identityLookupResults).where(eq(identityLookupResults.userId, m.userId)),
    ).toHaveLength(0);
    const [p] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.id, m.creatorId));
    expect(p).toMatchObject({ legalName: "Tara Bose", legalNameSource: "self_declared" });
  });

  it("rejects unknown purposes", async () => {
    const m = await member("tara.unknown.test");
    await expect(
      withdrawPurpose({ db }, { userId: m.userId, key: "everything", source: "settings" }),
    ).rejects.toMatchObject({
      code: "unknown_purpose",
    });
    // Sanity: receipts of other users are never touched.
    expect(
      await db
        .select()
        .from(consentWithdrawals)
        .where(inArray(consentWithdrawals.userId, [m.userId])),
    ).toHaveLength(0);
  });
});
