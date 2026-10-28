import { randomBytes } from "node:crypto";

import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  accessRequests,
  brands,
  consentReceipts,
  creatorPointsLedger,
  creatorProfessionalFeatures,
  creatorProfiles,
  creatorStatusRuns,
  professionalGraphRuns,
  users,
} from "@/db/schema";
import {
  AccessError,
  cancelAccessRequest,
  closeOpportunity,
  createOpportunity,
  decideAccessRequest,
  expireAccessRequests,
  getOpportunityForCreator,
  getRequestForStaff,
  listOpportunitiesForCreator,
  requestAccess,
  updateOpportunity,
} from "@/modules/access";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import {
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import { getCreatorStatus, refreshCreatorStatus } from "@/modules/creator-status/status-service";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { grantPurpose, withdrawPurpose } from "@/modules/privacy";
import { getPointsSummary, pointsBalance, syncMilestonePoints } from "@/modules/rewards/ledger-service";
import { completeConnection, startConnection } from "@/modules/social-data/connection-service";
import { MockSocialDataProvider, encodeMockCode } from "@/providers/social/mock-social-data-provider";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const def = (key: string) => CONSENT_DEFINITION_SEEDS.find((d) => d.key === key)!.id;
const BRAND_CONSENT = def(CONSENT_KEYS.brandOpportunities);
const DAY = 86_400_000;

async function member(handle: string) {
  const r = await signUpCreator(auth, { email: testEmail("access"), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Mira Iyer",
      displayName: "Mira Makes",
      city: "Chennai",
      state: "Tamil Nadu",
      languages: ["ta"],
    }),
  );
  await saveProfileStep(
    db,
    userId,
    profileStepSchema.parse({
      primaryCreatorHandle: handle,
      categories: ["beauty"],
      primaryCategory: "beauty",
      creatorSince: "2019-01",
      platforms: ["instagram"],
    }),
  );
  await saveBusinessStep(
    db,
    userId,
    businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" }),
  );
  await saveInterestsStep(db, userId, {
    prInterest: true,
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

async function staffUser() {
  const r = await signUpCreator(auth, { email: testEmail("partnerships"), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  await db.update(users).set({ role: "partnerships_admin" }).where(eq(users.id, r.user.userId));
  return r.user.userId;
}

let brandId: string | null = null;
async function brand() {
  if (brandId) return brandId;
  const [b] = await db
    .insert(brands)
    .values({ name: `Test Brand ${randomBytes(4).toString("hex")}`, category: "Beauty" })
    .returning({ id: brands.id });
  brandId = b!.id;
  return brandId;
}

async function opportunity(
  staff: string,
  overrides: Partial<{ minTier: "member" | "onyx" | "icon"; pointsCost: number; seats: number; closesAt: Date }> = {},
) {
  const now = Date.now();
  return createOpportunity(db, {
    staffUserId: staff,
    values: {
      brandId: await brand(),
      title: "Test Drop",
      kind: "pr_drop",
      category: "Beauty",
      summary: "A test opportunity.",
      details: "Details of a test opportunity.",
      minTier: overrides.minTier ?? "member",
      pointsCost: overrides.pointsCost ?? 300,
      seats: overrides.seats ?? 5,
      opensAt: new Date(now - DAY),
      closesAt: overrides.closesAt ?? new Date(now + 30 * DAY),
      status: "live",
    },
  });
}

/** Stores a Professional Graph run with chosen signal values and evaluates Status from it. */
async function setSignals(
  creatorId: string,
  v: { longevity: number; platforms: number; audience: number; engagement: number; stability: number; posting: number },
) {
  const now = new Date();
  const [run] = await db
    .insert(professionalGraphRuns)
    .values({
      creatorId,
      engineVersion: "pg-test",
      inputsHash: randomBytes(32).toString("hex"),
      snapshotCount: 24,
      trigger: "manual",
      computedAt: now,
    })
    .returning({ id: professionalGraphRuns.id });
  const f = (key: string, value: number | boolean, source = "verified") => ({
    runId: run!.id,
    creatorId,
    featureKey: key,
    featureVersion: "1",
    valueNumeric: typeof value === "number" ? String(value) : null,
    valueBoolean: typeof value === "boolean" ? value : null,
    unit: "count",
    source: source as "verified",
    completeness: "1",
    confidence: "high" as const,
    computedAt: now,
  });
  await db
    .insert(creatorProfessionalFeatures)
    .values([
      f("professional_longevity_months", v.longevity),
      f("connected_platforms", v.platforms),
      f("total_audience", v.audience),
      f("engagement_rate_3m", v.engagement),
      f("engagement_stability", v.stability, "derived"),
      f("posting_consistency_12m", v.posting, "derived"),
      f("follower_spike_detected", false, "derived"),
      f("handle_mismatches", 0, "derived"),
    ]);
  return refreshCreatorStatus(db, { creatorId, graphRunId: run!.id, now });
}

const ONYX = { longevity: 30, platforms: 1, audience: 40_000, engagement: 0.025, stability: 0.5, posting: 0.8 };
const ICON = { longevity: 60, platforms: 2, audience: 3_00_000, engagement: 0.035, stability: 0.8, posting: 0.9 };

const requestOf = async (id: string) => (await db.select().from(accessRequests).where(eq(accessRequests.id, id)))[0]!;

describe("Creator Points milestones", () => {
  it("grants the welcome points on completing onboarding, once", async () => {
    const m = await member("mira.welcome.test");
    expect(await pointsBalance(db, m.creatorId)).toBe(500);
    await syncMilestonePoints(db, { userId: m.userId });
    await syncMilestonePoints(db, { userId: m.userId });
    expect(await pointsBalance(db, m.creatorId)).toBe(500);
    const summary = await getPointsSummary(db, m.creatorId);
    expect(summary.history).toMatchObject([{ type: "earned", amount: 500, label: "Welcome to CreatorCo" }]);
  });
});

describe("Creator Status", () => {
  it("is Member until signals exist, then follows the rules — and grants tier points once", async () => {
    const m = await member("mira.status.test");
    expect(await getCreatorStatus(db, m.creatorId)).toMatchObject({ tier: "member", basis: "no_signals" });

    expect(await setSignals(m.creatorId, ONYX)).toMatchObject({ ok: true, tier: "onyx", changed: true });
    expect(await pointsBalance(db, m.creatorId)).toBe(500 + 1_000);

    expect(await setSignals(m.creatorId, ICON)).toMatchObject({ ok: true, tier: "icon" });
    expect(await pointsBalance(db, m.creatorId)).toBe(500 + 1_000 + 2_500);

    // Dropping back to Member never claws points back; reaching Onyx again grants nothing new.
    expect(await setSignals(m.creatorId, { ...ONYX, audience: 1_000 })).toMatchObject({ tier: "member" });
    await setSignals(m.creatorId, ONYX);
    expect(await pointsBalance(db, m.creatorId)).toBe(4_000);
    const status = await getCreatorStatus(db, m.creatorId);
    expect(status).toMatchObject({ tier: "onyx", basis: "signals", rulesVersion: "cs-0.1.0" });
    expect(status.criteria.every((c) => c.tier === "onyx" || c.tier === "icon")).toBe(true);
  });

  it("is evaluated after a real Professional Graph run, and erased with the signals", async () => {
    const m = await member("mira.graph.test");
    const social = { db, social: new MockSocialDataProvider() };
    const { authorizationUrl } = await startConnection(social, {
      userId: m.userId,
      platform: "instagram",
      redirectUri: "http://localhost/cb",
      connectionConsentId: def(CONSENT_KEYS.socialAccountConnection),
      analyticsConsentId: def(CONSENT_KEYS.professionalAnalytics),
    });
    const state = new URL(authorizationUrl, "http://x").searchParams.get("state")!;
    await completeConnection(social, {
      userId: m.userId,
      state,
      code: encodeMockCode({ platform: "instagram", handle: "mira.graph.test", nonce: "n" }),
    });
    const runs = await db.select().from(creatorStatusRuns).where(eq(creatorStatusRuns.creatorId, m.creatorId));
    expect(runs).toHaveLength(1);
    expect((await getCreatorStatus(db, m.creatorId)).basis).toBe("signals");

    const before = await pointsBalance(db, m.creatorId);
    await withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.professionalAnalytics, source: "settings" });
    expect(await db.select().from(creatorStatusRuns).where(eq(creatorStatusRuns.creatorId, m.creatorId))).toEqual([]);
    expect(await getCreatorStatus(db, m.creatorId)).toMatchObject({ tier: "member", basis: "no_signals" });
    expect(await pointsBalance(db, m.creatorId)).toBe(before);
  });

  it("status runs are append-only", async () => {
    const m = await member("mira.guard.test");
    const r = await setSignals(m.creatorId, ONYX);
    if (!r.ok) throw new Error("no status");
    await expect(
      db.update(creatorStatusRuns).set({ tier: "icon" }).where(eq(creatorStatusRuns.id, r.runId)),
    ).rejects.toThrow();
  });
});

describe("Access requests", () => {
  it("requires the brand consent, granted with the request or not at all", async () => {
    const staff = await staffUser();
    const m = await member("mira.consent.test");
    const id = await opportunity(staff);
    await expect(
      requestAccess(db, { userId: m.userId, opportunityId: id, note: null, source: "settings" }),
    ).rejects.toMatchObject({ code: "consent_required" });
    // A failed request (not enough points) never leaves the consent granted.
    const pricey = await opportunity(staff, { pointsCost: 5_000 });
    await expect(
      requestAccess(db, {
        userId: m.userId,
        opportunityId: pricey,
        note: null,
        consentDefinitionId: BRAND_CONSENT,
        source: "settings",
      }),
    ).rejects.toMatchObject({ code: "insufficient_points" });
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.brandOpportunities)).toBe(false);

    const { requestId } = await requestAccess(db, {
      userId: m.userId,
      opportunityId: id,
      note: "Autumn skincare fits my routine videos.",
      consentDefinitionId: BRAND_CONSENT,
      source: "settings",
    });
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.brandOpportunities)).toBe(true);
    const r = await requestOf(requestId);
    expect(r).toMatchObject({ status: "requested", pointsHeld: 300, tierAtRequest: "member" });
    const [receipt] = await db.select().from(consentReceipts).where(eq(consentReceipts.id, r.consentReceiptId));
    expect(receipt!.metadata).toMatchObject({ surface: "access_request" });
    expect(await getPointsSummary(db, m.creatorId)).toMatchObject({ balance: 200, onHold: 300 });

    // One live request per opportunity.
    await expect(
      requestAccess(db, { userId: m.userId, opportunityId: id, note: null, source: "settings" }),
    ).rejects.toMatchObject({ code: "wrong_state" });
    const view = await getOpportunityForCreator(db, { userId: m.userId, creatorId: m.creatorId, opportunityId: id });
    expect(view).toMatchObject({ availability: "requested", request: { status: "requested", pointsHeld: 300 } });
  });

  it("gates by Creator Status and points, and free opportunities hold nothing", async () => {
    const staff = await staffUser();
    const m = await member("mira.gate.test");
    const onyxOnly = await opportunity(staff, { minTier: "onyx", pointsCost: 800 });
    const free = await opportunity(staff, { pointsCost: 0 });
    const list = await listOpportunitiesForCreator(db, { userId: m.userId, creatorId: m.creatorId });
    expect(list.find((o) => o.id === onyxOnly)?.availability).toBe("tier_locked");
    await expect(
      requestAccess(db, {
        userId: m.userId,
        opportunityId: onyxOnly,
        note: null,
        consentDefinitionId: BRAND_CONSENT,
        source: "api",
      }),
    ).rejects.toMatchObject({ code: "tier_required" });

    await requestAccess(db, {
      userId: m.userId,
      opportunityId: free,
      note: null,
      consentDefinitionId: BRAND_CONSENT,
      source: "api",
    });
    expect(await pointsBalance(db, m.creatorId)).toBe(500);

    await setSignals(m.creatorId, ONYX); // +1,000 points
    const { requestId } = await requestAccess(db, {
      userId: m.userId,
      opportunityId: onyxOnly,
      note: null,
      source: "api",
    });
    expect(await requestOf(requestId)).toMatchObject({ tierAtRequest: "onyx", pointsHeld: 800 });
    expect(await getPointsSummary(db, m.creatorId)).toMatchObject({ balance: 700, onHold: 800 });
  });

  it("approve spends the hold; decline and cancel return it; seats are enforced", async () => {
    const staff = await staffUser();
    const a = await member("mira.seat.a.test");
    const b = await member("mira.seat.b.test");
    const c = await member("mira.seat.c.test");
    const id = await opportunity(staff, { seats: 1 });
    const ask = (userId: string) =>
      requestAccess(db, { userId, opportunityId: id, note: null, consentDefinitionId: BRAND_CONSENT, source: "api" });
    const ra = await ask(a.userId);
    const rb = await ask(b.userId);
    const rc = await ask(c.userId);

    await decideAccessRequest(db, { staffUserId: staff, requestId: ra.requestId, decision: { decision: "approve" } });
    expect(await requestOf(ra.requestId)).toMatchObject({ status: "approved", decidedBy: staff });
    expect(await getPointsSummary(db, a.creatorId)).toMatchObject({ balance: 200, onHold: 0 });
    expect((await getPointsSummary(db, a.creatorId)).history[0]).toMatchObject({ type: "spent", amount: -300 });

    await expect(
      decideAccessRequest(db, { staffUserId: staff, requestId: rb.requestId, decision: { decision: "approve" } }),
    ).rejects.toMatchObject({ code: "full" });
    await decideAccessRequest(db, {
      staffUserId: staff,
      requestId: rb.requestId,
      decision: { decision: "decline", reason: "no_seats" },
    });
    expect(await requestOf(rb.requestId)).toMatchObject({ status: "declined", declineReason: "no_seats" });
    expect(await getPointsSummary(db, b.creatorId)).toMatchObject({ balance: 500, onHold: 0 });

    await cancelAccessRequest(db, { userId: c.userId, requestId: rc.requestId });
    expect(await pointsBalance(db, c.creatorId)).toBe(500);
    await expect(cancelAccessRequest(db, { userId: c.userId, requestId: rc.requestId })).rejects.toMatchObject({
      code: "wrong_state",
    });
    // Someone else's request isn't visible.
    await expect(cancelAccessRequest(db, { userId: a.userId, requestId: rb.requestId })).rejects.toMatchObject({
      code: "not_found",
    });
    // A full opportunity is shown as full.
    const view = await getOpportunityForCreator(db, { userId: c.userId, creatorId: c.creatorId, opportunityId: id });
    expect(view).toMatchObject({ availability: "full", seatsLeft: 0 });
    // Closed requests never change again (DB-enforced).
    await expect(
      db.update(accessRequests).set({ status: "cancelled" }).where(eq(accessRequests.id, ra.requestId)),
    ).rejects.toThrow();
    await expect(
      db.delete(creatorPointsLedger).where(eq(creatorPointsLedger.creatorId, a.creatorId)),
    ).rejects.toThrow();
  });

  it("closing an opportunity, or its window ending, expires pending requests and returns points", async () => {
    const staff = await staffUser();
    const m = await member("mira.close.test");
    const first = await opportunity(staff);
    const second = await opportunity(staff, { pointsCost: 100, closesAt: new Date(Date.now() + DAY) });
    const r1 = await requestAccess(db, {
      userId: m.userId,
      opportunityId: first,
      note: null,
      consentDefinitionId: BRAND_CONSENT,
      source: "api",
    });
    const r2 = await requestAccess(db, { userId: m.userId, opportunityId: second, note: null, source: "api" });
    expect(await pointsBalance(db, m.creatorId)).toBe(100);

    expect(await closeOpportunity(db, { staffUserId: staff, id: first })).toEqual({ expired: 1 });
    expect(await requestOf(r1.requestId)).toMatchObject({ status: "expired" });
    await expect(
      updateOpportunity(db, {
        staffUserId: staff,
        id: first,
        values: {
          brandId: await brand(),
          title: "Edited",
          kind: "pr_drop",
          category: "Beauty",
          summary: "x".repeat(10),
          details: "x".repeat(10),
          minTier: "member",
          pointsCost: 1,
          seats: 1,
          opensAt: new Date(),
          closesAt: new Date(Date.now() + DAY),
          status: "live",
        },
      }),
    ).rejects.toBeInstanceOf(AccessError);

    const swept = await expireAccessRequests({ db, now: new Date(Date.now() + 2 * DAY) });
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect(await requestOf(r2.requestId)).toMatchObject({ status: "expired" });
    expect(await pointsBalance(db, m.creatorId)).toBe(500);
    await expect(
      requestAccess(db, { userId: m.userId, opportunityId: first, note: null, source: "api" }),
    ).rejects.toMatchObject({ code: "closed" });
  });

  it("pausing membership cancels pending requests; paused members can't request", async () => {
    const staff = await staffUser();
    const m = await member("mira.paused.test");
    const id = await opportunity(staff);
    const { requestId } = await requestAccess(db, {
      userId: m.userId,
      opportunityId: id,
      note: null,
      consentDefinitionId: BRAND_CONSENT,
      source: "api",
    });
    const paused = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.creatorProfile, source: "settings" },
    );
    expect(paused.effects).toEqual({ membership_paused: true, access_requests_cancelled: 1 });
    expect(await requestOf(requestId)).toMatchObject({ status: "cancelled" });
    expect(await pointsBalance(db, m.creatorId)).toBe(500);
    await expect(
      decideAccessRequest(db, { staffUserId: staff, requestId, decision: { decision: "approve" } }),
    ).rejects.toMatchObject({ code: "wrong_state" });
    const other = await opportunity(staff, { pointsCost: 0 });
    await expect(
      requestAccess(db, { userId: m.userId, opportunityId: other, note: null, source: "api" }),
    ).rejects.toMatchObject({ code: "profile_inactive" });
    const detail = await getRequestForStaff(db, { requestId, staffUserId: staff });
    expect(detail?.creator).toMatchObject({ paused: true, displayName: "Mira Makes", category: "Beauty" });
    await grantPurpose(
      { db },
      {
        userId: m.userId,
        key: CONSENT_KEYS.creatorProfile,
        consentDefinitionId: def(CONSENT_KEYS.creatorProfile),
        source: "settings",
      },
    );
    const again = await requestAccess(db, { userId: m.userId, opportunityId: id, note: null, source: "api" });
    expect(await requestOf(again.requestId)).toMatchObject({ status: "requested" });
  });

  it("places can't be cut below the approvals already given", async () => {
    const staff = await staffUser();
    const id = await opportunity(staff, { pointsCost: 0, seats: 3 });
    for (const handle of ["mira.places.a.test", "mira.places.b.test"]) {
      const m = await member(handle);
      const r = await requestAccess(db, {
        userId: m.userId,
        opportunityId: id,
        note: null,
        consentDefinitionId: BRAND_CONSENT,
        source: "api",
      });
      await decideAccessRequest(db, { staffUserId: staff, requestId: r.requestId, decision: { decision: "approve" } });
    }
    const now = Date.now();
    const values = {
      brandId: await brand(),
      title: "Test Drop",
      kind: "pr_drop" as const,
      category: "Beauty",
      summary: "A test opportunity.",
      details: "Details of a test opportunity.",
      minTier: "member" as const,
      pointsCost: 0,
      opensAt: new Date(now - DAY),
      closesAt: new Date(now + 30 * DAY),
      status: "live" as const,
    };
    await expect(
      updateOpportunity(db, { staffUserId: staff, id, values: { ...values, seats: 1 } }),
    ).rejects.toMatchObject({ code: "invalid" });
    await updateOpportunity(db, { staffUserId: staff, id, values: { ...values, seats: 2 } });
  });

  it("withdrawing the brand consent cancels pending requests, returns points and erases the history", async () => {
    const staff = await staffUser();
    const m = await member("mira.withdraw.test");
    const approvedOpp = await opportunity(staff, { pointsCost: 200 });
    const pendingOpp = await opportunity(staff, { pointsCost: 100 });
    const a = await requestAccess(db, {
      userId: m.userId,
      opportunityId: approvedOpp,
      note: "A note that must be erased.",
      consentDefinitionId: BRAND_CONSENT,
      source: "api",
    });
    await requestAccess(db, { userId: m.userId, opportunityId: pendingOpp, note: null, source: "api" });
    await decideAccessRequest(db, { staffUserId: staff, requestId: a.requestId, decision: { decision: "approve" } });
    expect(await getPointsSummary(db, m.creatorId)).toMatchObject({ balance: 200, onHold: 100 });

    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.brandOpportunities, source: "settings" },
    );
    expect(result.effects).toEqual({ access_requests_cancelled: 1 });
    expect(result.erasures).toEqual([{ scope: "access_requests", status: "completed", holdReasons: [] }]);
    const [left] = await db.select({ n: count() }).from(accessRequests).where(eq(accessRequests.userId, m.userId));
    expect(left!.n).toBe(0);
    // The pending hold came back; the approved one stays spent (its request reference cleared).
    const summary = await getPointsSummary(db, m.creatorId);
    expect(summary).toMatchObject({ balance: 300, onHold: 0 });
    expect(summary.history.find((e) => e.type === "spent")).toMatchObject({
      amount: -200,
      label: "Spent on an opportunity",
    });
    expect(summary.history.filter((e) => e.type === "returned")).toHaveLength(1);
    // New requests need the consent again.
    await expect(
      requestAccess(db, { userId: m.userId, opportunityId: pendingOpp, note: null, source: "api" }),
    ).rejects.toMatchObject({ code: "consent_required" });
  });
});
