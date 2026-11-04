import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { analyticsDailyCounts, analyticsEvents, creatorProfiles, users } from "@/db/schema";
import { analyticsSubject, recordEvent } from "@/modules/analytics";
import { FOLDED_LABEL, getAcquisition, getFunnel, getWeeklyCohorts } from "@/modules/analytics/funnel";
import { maintainAnalytics } from "@/modules/analytics/maintenance";
import { analyticsDay } from "@/modules/analytics/recorder";
import { CONSENT_KEYS } from "@/modules/consent";
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
import { decisionAnalytics } from "@/modules/lending/decision-analytics";
import { grantPurpose, withdrawPurpose } from "@/modules/privacy";
import { completeConnection, startConnection } from "@/modules/social-data/connection-service";
import { modelAnalytics } from "@/modules/underwriting/model-analytics";
import { MockSocialDataProvider, encodeMockCode } from "@/providers/social/mock-social-data-provider";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const def = (key: string) => CONSENT_DEFINITION_SEEDS.find((d) => d.key === key)!.id;

async function member(handle: string) {
  const email = testEmail("analytics");
  const r = await signUpCreator(auth, { email, password: "a long enough passphrase", client: "ios" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Neel Varma",
      displayName: "Neel Notes",
      city: "Pune",
      state: "Maharashtra",
      languages: ["mr"],
    }),
  );
  await saveProfileStep(
    db,
    userId,
    profileStepSchema.parse({
      primaryCreatorHandle: handle,
      categories: ["tech"],
      primaryCategory: "tech",
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
  return { userId, email, creatorId: p!.id };
}

const latest = (key: string) =>
  CONSENT_DEFINITION_SEEDS.filter((d) => d.key === key).sort((a, b) => b.version - a.version)[0]!.id;
const grant = (userId: string, key: string) =>
  grantPurpose({ db }, { userId, key, consentDefinitionId: latest(key), source: "settings" });

const eventsOf = (userId: string) =>
  db
    .select()
    .from(analyticsEvents)
    .where(eq(analyticsEvents.subject, analyticsSubject(userId)));

describe("analytics recording", () => {
  it("records the onboarding and connection funnel pseudonymously, with no personal data", async () => {
    const handle = "neel.funnel.test";
    const m = await member(handle);
    const social = { db, social: new MockSocialDataProvider() };
    for (const nonce of ["n1", "n2"]) {
      const { authorizationUrl } = await startConnection(social, {
        userId: m.userId,
        platform: nonce === "n1" ? "instagram" : "youtube",
        redirectUri: "http://localhost/cb",
        connectionConsentId: def(CONSENT_KEYS.socialAccountConnection),
        analyticsConsentId: def(CONSENT_KEYS.professionalAnalytics),
      });
      const state = new URL(authorizationUrl, "http://x").searchParams.get("state")!;
      await completeConnection(social, {
        userId: m.userId,
        state,
        code: encodeMockCode({ platform: nonce === "n1" ? "instagram" : "youtube", handle, nonce }),
      });
    }
    const events = await eventsOf(m.userId);
    const count = (e: string) => events.filter((x) => x.event === e).length;
    expect(count("account_created")).toBe(1);
    expect(count("creator_profile_completed")).toBe(1);
    expect(count("social_connection_started")).toBe(2);
    expect(count("social_connection_completed")).toBe(2);
    expect(count("passport_generated")).toBe(1); // once per creator
    expect(count("status_generated")).toBeGreaterThanOrEqual(1);
    expect(events.find((e) => e.event === "account_created")?.props).toEqual({
      client: "ios",
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      referrer: null,
    });
    expect(events.find((e) => e.event === "creator_profile_completed")?.props).toEqual({ category: "tech" });
    expect(events.every((e) => e.tier === "essential" && e.internal)).toBe(true); // .test accounts are flagged
    const text = JSON.stringify(events);
    for (const secret of [m.userId, m.email, handle, "Neel", "Pune"]) expect(text).not.toContain(secret);
  });

  it("optional screen views need the Product analytics consent; withdrawing it erases them only", async () => {
    const m = await member("neel.optional.test");
    await grant(m.userId, CONSENT_KEYS.financialEligibility); // offer steps also need this one
    expect(await recordEvent(db, { event: "offer_viewed", userId: m.userId, props: { simulated: true } })).toBe(
      "no_consent",
    );
    await grantPurpose(
      { db },
      {
        userId: m.userId,
        key: CONSENT_KEYS.productAnalytics,
        consentDefinitionId: def(CONSENT_KEYS.productAnalytics),
        source: "settings",
      },
    );
    expect(await recordEvent(db, { event: "offer_viewed", userId: m.userId, props: { simulated: true } })).toBe(
      "recorded",
    );
    expect(
      await recordEvent(db, { event: "access_opportunity_viewed", userId: m.userId, props: { kind: "event" } }),
    ).toBe("recorded");
    const before = await eventsOf(m.userId);
    expect(before.filter((e) => e.tier === "optional")).toHaveLength(2);

    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.productAnalytics, source: "settings" },
    );
    expect(result.erasures).toEqual([{ scope: "product_analytics_events", status: "completed", holdReasons: [] }]);
    const after = await eventsOf(m.userId);
    expect(after.filter((e) => e.tier === "optional")).toHaveLength(0);
    expect(after.filter((e) => e.tier === "essential").length).toBe(before.length - 2);
    expect(await recordEvent(db, { event: "offer_viewed", userId: m.userId, props: { simulated: false } })).toBe(
      "no_consent",
    );
  });

  it("never records staff; rejects malformed events loudly in tests; raw events are append-only", async () => {
    const r = await signUpCreator(auth, { email: testEmail("staff"), password: "a long enough passphrase" });
    if (!r.ok) throw new Error("signup failed");
    await db.update(users).set({ role: "analyst" }).where(eq(users.id, r.user.userId));
    expect(await recordEvent(db, { event: "financial_eligibility_started", userId: r.user.userId })).toBe("staff");
    await expect(
      recordEvent(db, {
        event: "account_created",
        userId: r.user.userId,
        props: { client: "web", email: "x" } as never,
      }),
    ).rejects.toThrow();
    await expect(recordEvent(db, { event: "landing_viewed", userId: r.user.userId })).rejects.toThrow();
    expect(await recordEvent(db, { event: "landing_viewed" })).toBe("recorded");
    const [anon] = await db.select().from(analyticsEvents).where(eq(analyticsEvents.event, "landing_viewed")).limit(1);
    expect(anon).toMatchObject({ subject: null, props: {} });
    await expect(
      db.update(analyticsEvents).set({ internal: true }).where(eq(analyticsEvents.id, anon!.id)),
    ).rejects.toThrow();
    await expect(db.delete(analyticsEvents).where(eq(analyticsEvents.id, anon!.id))).rejects.toThrow();
  });
});

describe("funnel, cohorts and suppression", () => {
  it("counts a cohort's progress and hides small cells", async () => {
    const today = analyticsDay(new Date());
    const members = [];
    for (let i = 0; i < 6; i += 1) members.push(await member(`neel.cohort${i}.test`));
    // Two of the six start an eligibility check (fewer than 5 → hidden).
    for (const m of members.slice(0, 2))
      await recordEvent(db, { event: "financial_eligibility_started", userId: m.userId });

    const funnel = await getFunnel(db, { fromDay: today, toDay: today, includeInternal: true });
    const step = (e: string) => funnel.steps.find((s) => s.event === e)!;
    expect(step("account_created").creators.value).toBeGreaterThanOrEqual(6);
    expect(step("creator_profile_completed").creators.value).toBeGreaterThanOrEqual(6);
    // Other tests add to today's cohort, so only the shape is asserted for the small step.
    const elig = step("financial_eligibility_started");
    if (elig.creators.suppressed) expect(elig.ofCohortPct).toBeNull();
    // Test accounts are excluded unless asked for.
    const real = await getFunnel(db, { fromDay: today, toDay: today, includeInternal: false });
    expect(real.steps[0]!.creators.value).toBe(0);

    const cohorts = await getWeeklyCohorts(db, { weeks: 2, today, includeInternal: true });
    expect(cohorts[0]!.size.value).toBeGreaterThanOrEqual(6);
    expect(cohorts[0]!.reached.creator_profile_completed).toBeGreaterThan(50);
  });

  it("rolls up daily counts and purges raw events after 24 months", async () => {
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 25);
    const oldDay = analyticsDay(old);
    await db.insert(analyticsEvents).values({
      event: "landing_viewed",
      eventVersion: 1,
      tier: "essential",
      subject: null,
      props: {},
      internal: false,
      day: oldDay,
    });
    const first = await maintainAnalytics({ db });
    expect(first.raw_events_purged).toBeGreaterThanOrEqual(1);
    const left = await db
      .select()
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.day, oldDay), eq(analyticsEvents.event, "landing_viewed")));
    expect(left).toEqual([]);
    const [rollup] = await db
      .select()
      .from(analyticsDailyCounts)
      .where(and(eq(analyticsDailyCounts.day, oldDay), eq(analyticsDailyCounts.event, "landing_viewed")));
    expect(rollup).toMatchObject({ events: 1, subjects: 0, internal: false });
    // Idempotent.
    const second = await maintainAnalytics({ db });
    expect(second.raw_events_purged).toBe(0);
    const today = await db
      .select()
      .from(analyticsDailyCounts)
      .where(
        and(
          eq(analyticsDailyCounts.day, analyticsDay(new Date())),
          inArray(analyticsDailyCounts.event, ["account_created"]),
        ),
      );
    expect(today.length).toBeGreaterThanOrEqual(1);
  });
});

describe("robustness", () => {
  it("a failing analytics step never rolls back the business action (production mode)", async () => {
    const m = await member("neel.robust.test");
    const env = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    process.env.ANALYTICS_PSEUDONYM_KEY = "x".repeat(40);
    try {
      const outcome = await db.transaction(async (tx) => {
        // Malformed props are dropped, not thrown.
        const bad = await recordEvent(tx, {
          event: "account_created",
          userId: m.userId,
          props: { client: "web", email: "x" } as never,
        });
        await tx.update(users).set({ status: "active" }).where(eq(users.id, m.userId));
        return bad;
      });
      expect(outcome).toBe("failed");
    } finally {
      process.env.APP_ENV = env;
      delete process.env.ANALYTICS_PSEUDONYM_KEY;
    }
    // A misconfigured key fails inside the savepoint; the caller's transaction still commits.
    process.env.APP_ENV = "production";
    try {
      const result = await db.transaction(async (tx) => {
        const r = await recordEvent(tx, {
          event: "social_connection_started",
          userId: m.userId,
          props: { platform: "instagram" },
        });
        await tx.update(users).set({ status: "active" }).where(eq(users.id, m.userId));
        return r;
      });
      expect(result).toBe("failed");
    } finally {
      process.env.APP_ENV = env;
    }
  });

  it("withdrawing the financial-eligibility consent erases eligibility and offer funnel events", async () => {
    const m = await member("neel.finfunnel.test");
    await grant(m.userId, CONSENT_KEYS.financialEligibility);
    await recordEvent(db, { event: "financial_eligibility_started", userId: m.userId });
    await recordEvent(db, { event: "offer_generated", userId: m.userId, props: { simulated: true } });
    await withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.financialEligibility, source: "settings" });
    const left = (await eventsOf(m.userId)).map((e) => e.event);
    expect(left).not.toContain("financial_eligibility_started");
    expect(left).not.toContain("offer_generated");
    expect(left).toContain("account_created");
  });

  it("two maintenance runs at once don't collide", async () => {
    const results = await Promise.all([maintainAnalytics({ db }), maintainAnalytics({ db })]);
    expect(results).toHaveLength(2);
  });

  it("once-events stay unique per creator even when recorded concurrently", async () => {
    const m = await member("neel.once.test");
    await Promise.all([1, 2, 3].map(() => recordEvent(db, { event: "passport_generated", userId: m.userId })));
    expect((await eventsOf(m.userId)).filter((e) => e.event === "passport_generated")).toHaveLength(1);
  });
});

describe("model analytics", () => {
  it("returns aggregates only, suppressing small counts", async () => {
    const m = await modelAnalytics(db);
    expect(m).toHaveProperty("paired.enhancedOnly");
    for (const r of m.byModel) if (r.runs.suppressed) expect(r.recommendPct).toBeNull();
    const d = await decisionAnalytics(db);
    expect(d.map((x) => x.lender)).toEqual(["simulated", "partner"]);
    expect(JSON.stringify({ m, d })).not.toMatch(/applicationId|userId|creatorId/);
  });
});

describe("sign-up attribution (Stage 16)", () => {
  it("records reviewed campaign tags on account_created and folds small values on the dashboard", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const sign = (campaign: string) =>
      signUpCreator(auth, {
        email: testEmail("attr"),
        password: "a long enough passphrase",
        attribution: { utm_source: "instagram", utm_medium: "bio", utm_campaign: campaign, referrer: "social" },
      });
    for (let i = 0; i < 5; i++) await sign(`alpha_${tag}`);
    for (let i = 0; i < 2; i++) await sign(`beta_${tag}`);
    const today = analyticsDay(new Date());
    const view = await getAcquisition(db, { fromDay: today, toDay: today, includeInternal: true });
    expect(view.campaign).toContainEqual({ value: `alpha_${tag}`, creators: { value: 5, suppressed: false } });
    expect(view.campaign.some((r) => r.value === `beta_${tag}`)).toBe(false);
    expect(view.campaign.some((r) => r.value === FOLDED_LABEL)).toBe(true);
    expect(view.referrer.find((r) => r.value === "social")?.creators.value).toBeGreaterThanOrEqual(7);
  });
});
