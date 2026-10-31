import { and, count, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  creatorProfessionalFeatures,
  creatorProfiles,
  creatorSocialAccounts,
  creatorSocialSnapshots,
  professionalGraphRuns,
  providerRequests,
} from "@/db/schema";
import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import {
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import { resolveSession, signIn, signUpCreator } from "@/modules/identity/auth/auth-service";
import { getPassport } from "@/modules/passport/passport-view";
import { withdrawPurpose } from "@/modules/privacy";
import {
  getLatestProfessionalGraph,
  runProfessionalGraph,
  verifyRunReproducible,
} from "@/modules/professional-graph/graph-service";
import {
  completeConnection,
  disconnectAccount,
  enableProfessionalAnalytics,
  refreshConnectedAccounts,
  setPrimaryAccount,
  startConnection,
  type ConnectionDeps,
} from "@/modules/social-data/connection-service";
import { MockSocialDataProvider, encodeMockCode } from "@/providers/social/mock-social-data-provider";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const def = (key: string) => CONSENT_DEFINITION_SEEDS.find((d) => d.key === key)!.id;
const PROFILE_CONSENT = def(CONSENT_KEYS.creatorProfile);
const CONNECT_CONSENT = def(CONSENT_KEYS.socialAccountConnection);
const ANALYTICS_CONSENT = def(CONSENT_KEYS.professionalAnalytics);
const REDIRECT = "http://localhost:3000/passport/connect/callback";

const NOW = new Date("2026-10-02T09:00:00.000Z");
const deps = (now = NOW): ConnectionDeps => ({ db, social: new MockSocialDataProvider(), now: () => now });

async function newCreator() {
  const r = await signUpCreator(auth, { email: testEmail(), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  return r.user.userId;
}

async function completedCreator(handle: string) {
  const userId = await newCreator();
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Ira Sen",
      displayName: "Ira Creates",
      city: "Pune",
      state: "Maharashtra",
      languages: ["en"],
    }),
  );
  await saveProfileStep(
    db,
    userId,
    profileStepSchema.parse({
      primaryCreatorHandle: handle,
      categories: ["fashion"],
      primaryCategory: "fashion",
      creatorSince: "2019-06",
      platforms: ["instagram", "youtube"],
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
  await completeOnboarding(db, userId, { consentDefinitionId: PROFILE_CONSENT });
  const [p] = await db
    .select({ id: creatorProfiles.id })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId));
  return { userId, creatorId: p!.id };
}

async function start(
  userId: string,
  opts: { analytics?: boolean; platform?: string; now?: Date; additional?: boolean } = {},
) {
  const { authorizationUrl } = await startConnection(deps(opts.now), {
    userId,
    platform: opts.platform ?? "instagram",
    redirectUri: REDIRECT,
    connectionConsentId: CONNECT_CONSENT,
    analyticsConsentId: opts.analytics ? ANALYTICS_CONSENT : null,
    additional: opts.additional,
  });
  const url = new URL(authorizationUrl, "http://localhost");
  expect(url.pathname).toBe("/connect/mock");
  expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
  return url.searchParams.get("state")!;
}

const code = (handle: string, platform = "instagram") => encodeMockCode({ platform, handle, nonce: "n1" });

describe("social account connection (Stage 06)", () => {
  let ira: { userId: string; creatorId: string };
  let accountId: string;

  beforeAll(async () => {
    ira = await completedCreator("ira.creates.test");
  });

  it("refuses to start before onboarding is complete", async () => {
    const userId = await newCreator();
    await expect(
      startConnection(deps(), {
        userId,
        platform: "instagram",
        redirectUri: REDIRECT,
        connectionConsentId: CONNECT_CONSENT,
      }),
    ).rejects.toMatchObject({ code: "profile_incomplete" });
  });

  it("rejects platforms the provider can't connect", async () => {
    await expect(start(ira.userId, { platform: "tiktok" })).rejects.toMatchObject({ code: "unsupported_platform" });
  });

  it("stores only a hash of the state and records the connection consent", async () => {
    const state = await start(ira.userId, { analytics: true });
    const rows = await db.execute(
      sql`select state_hash from social_connection_requests where state_hash = encode(sha256(${state}::bytea), 'hex')`,
    );
    expect(rows.length).toBe(1);
    const raw = await db.execute(
      sql`select count(*)::int as n from social_connection_requests where state_hash = ${state}`,
    );
    expect(raw[0]!.n).toBe(0);
    expect(await hasValidConsent(db, ira.userId, CONSENT_KEYS.socialAccountConnection)).toBe(true);
    expect(await hasValidConsent(db, ira.userId, CONSENT_KEYS.professionalAnalytics)).toBe(true);

    const result = await completeConnection(deps(), { userId: ira.userId, state, code: code("ira.creates.test") });
    accountId = result.accountId;
    expect(result).toMatchObject({
      platform: "instagram",
      handle: "ira.creates.test",
      snapshotsStored: 12,
      graphComputed: true,
    });

    // The declared row was upgraded in place, not duplicated.
    const rows2 = await db
      .select()
      .from(creatorSocialAccounts)
      .where(and(eq(creatorSocialAccounts.creatorId, ira.creatorId), eq(creatorSocialAccounts.platform, "instagram")));
    expect(rows2).toHaveLength(1);
    expect(rows2[0]).toMatchObject({
      connectionStatus: "connected",
      provider: "mock",
      declaredHandle: "ira.creates.test",
    });
    expect(rows2[0]!.externalAccountId).toMatch(/^mock-instagram-/);
  });

  it("logs provider calls as metadata only", async () => {
    const calls = await db
      .select({ op: providerRequests.operation, outcome: providerRequests.outcome })
      .from(providerRequests)
      .where(and(eq(providerRequests.userId, ira.userId), eq(providerRequests.providerKind, "social")));
    expect(calls.map((c) => c.op).sort()).toEqual(["begin_connection", "complete_connection", "fetch_history"]);
  });

  it("makes each state single-use, owner-bound and short-lived", async () => {
    const state = await start(ira.userId, { platform: "youtube" });
    const other = await completedCreator("someone.else.test");
    await expect(
      completeConnection(deps(), { userId: other.userId, state, code: code("x.test", "youtube") }),
    ).rejects.toMatchObject({
      code: "invalid_state",
    });
    const late = new Date(NOW.getTime() + 11 * 60_000);
    await expect(
      completeConnection(deps(late), { userId: ira.userId, state, code: code("ira.tv", "youtube") }),
    ).rejects.toMatchObject({
      code: "expired",
    });
    await expect(
      completeConnection(deps(), { userId: ira.userId, state: "nope".repeat(8), code: "x" }),
    ).rejects.toMatchObject({
      code: "invalid_state",
    });

    const fresh = await start(ira.userId, { platform: "youtube" });
    await expect(
      completeConnection(deps(), { userId: ira.userId, state: fresh, code: code("ira.tv", "instagram") }),
    ).rejects.toThrow();
    // The state survives a failed exchange only until it is successfully claimed once.
    await completeConnection(deps(), { userId: ira.userId, state: fresh, code: code("IraTV", "youtube") });
    await expect(
      completeConnection(deps(), { userId: ira.userId, state: fresh, code: code("IraTV", "youtube") }),
    ).rejects.toMatchObject({
      code: "already_used",
    });
  });

  it("asks to start again if the provider was switched in the control plane mid-flow", async () => {
    const c = await completedCreator("switched.mid.flow.test");
    const state = await start(c.userId);
    const mock = new MockSocialDataProvider();
    const switched = new Proxy(mock, {
      get: (t, p, r) => (p === "descriptor" ? { ...t.descriptor, key: "social_b" } : Reflect.get(t, p, r)),
    });
    await expect(
      completeConnection(
        { db, social: switched, now: () => NOW },
        { userId: c.userId, state, code: code("switched.mid.flow.test") },
      ),
    ).rejects.toMatchObject({ code: "provider_changed" });

    // With a resolver for the issuing config, the flow completes on that provider.
    const again = await start(c.userId);
    const done = await completeConnection(
      { db, social: switched, socialFor: async (key) => (key === "mock" ? mock : null), now: () => NOW },
      { userId: c.userId, state: again, code: code("switched.mid.flow.test") },
    );
    expect(done.platform).toBe("instagram");
  });

  it("refuses to link one external account to two creators", async () => {
    const other = await completedCreator("copycat.test");
    const state = await start(other.userId);
    await expect(
      completeConnection(deps(), { userId: other.userId, state, code: code("ira.creates.test") }),
    ).rejects.toMatchObject({ code: "linked_elsewhere" });
  });

  it("ingests history idempotently and reuses identical graph runs", async () => {
    const before = await db
      .select({ n: count() })
      .from(professionalGraphRuns)
      .where(eq(professionalGraphRuns.creatorId, ira.creatorId));
    const refreshed = await refreshConnectedAccounts(deps(), { userId: ira.userId });
    expect(refreshed).toMatchObject({ accounts: 2, snapshotsStored: 0, graphComputed: true });
    const after = await db
      .select({ n: count() })
      .from(professionalGraphRuns)
      .where(eq(professionalGraphRuns.creatorId, ira.creatorId));
    expect(after[0]!.n).toBe(before[0]!.n);

    const [snaps] = await db
      .select({ n: count() })
      .from(creatorSocialSnapshots)
      .where(eq(creatorSocialSnapshots.socialAccountId, accountId));
    expect(snaps!.n).toBe(12);
  });

  it("stores reproducible, versioned runs with per-feature provenance", async () => {
    const graph = await getLatestProfessionalGraph(db, ira.creatorId);
    expect(graph).not.toBeNull();
    expect(graph!.engineVersion).toBe("pg-0.3.0");
    expect(graph!.features).toHaveLength(26); // 12 social + 14 brand-work features (Stage 18)
    const longevity = graph!.features.find((f) => f.key === "professional_longevity_months")!;
    expect(longevity).toMatchObject({ source: "verified", confidence: "high" });
    expect(graph!.features.find((f) => f.key === "connected_platforms")!.value).toBe(2);
    expect(graph!.features.find((f) => f.key === "handle_mismatches")!.value).toBe(1); // youtube: IraTV vs declared ira.creates.test
    expect(await verifyRunReproducible(db, graph!.runId)).toBe(true);
  });

  it("keeps graph runs and features append-only", async () => {
    const graph = await getLatestProfessionalGraph(db, ira.creatorId);
    await expect(
      db.update(professionalGraphRuns).set({ snapshotCount: 0 }).where(eq(professionalGraphRuns.id, graph!.runId)),
    ).rejects.toThrow();
    await expect(
      db.delete(creatorProfessionalFeatures).where(eq(creatorProfessionalFeatures.runId, graph!.runId)),
    ).rejects.toThrow();
  });

  it("exposes a Passport without restricted fields or credit figures", async () => {
    const passport = await getPassport(db, ira.userId);
    expect(passport).not.toBeNull();
    expect(passport!.verifications.find((v) => v.key === "social")).toMatchObject({ state: "verified" });
    expect(passport!.accounts.filter((a) => a.status === "connected")).toHaveLength(2);
    expect(passport!.graph).not.toBeNull();
    expect(passport!.memberNumber).toMatch(/^CC [0-9A-F]{4} [0-9A-F]{4}$/);
    // Consent texts are shown verbatim (and mention "credit score" to say it isn't one), so check the data only.
    const { consents: _consents, ...data } = passport!;
    expect(JSON.stringify(data)).not.toMatch(/gstin|"pan|"mobile":|credit|limit|\+91/i);
  });

  it("disconnecting a declared platform returns it to self-declared and keeps history", async () => {
    await disconnectAccount(deps(), { userId: ira.userId, accountId });
    const [row] = await db.select().from(creatorSocialAccounts).where(eq(creatorSocialAccounts.id, accountId));
    expect(row).toMatchObject({
      connectionStatus: "declared",
      provider: "self_declared",
      handle: "ira.creates.test",
      externalAccountId: null,
    });
    const [snaps] = await db
      .select({ n: count() })
      .from(creatorSocialSnapshots)
      .where(eq(creatorSocialSnapshots.socialAccountId, accountId));
    expect(snaps!.n).toBe(12);
    await expect(disconnectAccount(deps(), { userId: ira.userId, accountId })).rejects.toMatchObject({
      code: "not_found",
    });

    // Reconnecting reuses the same row.
    const state = await start(ira.userId);
    const again = await completeConnection(deps(), { userId: ira.userId, state, code: code("ira.creates.test") });
    expect(again.accountId).toBe(accountId);
    expect(again.snapshotsStored).toBe(0);
  });

  it("a creator can't disconnect someone else's account", async () => {
    const other = await completedCreator("nosy.test");
    await expect(disconnectAccount(deps(), { userId: other.userId, accountId })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("professional analytics consent gating (Stage 07)", () => {
  it("connects without computing signals until analytics is turned on, and stops when turned off", async () => {
    const c = await completedCreator("quiet.creator.test");
    const state = await start(c.userId, { analytics: false });
    const r = await completeConnection(deps(), { userId: c.userId, state, code: code("quiet.creator.test") });
    expect(r.graphComputed).toBe(false);
    expect(
      await runProfessionalGraph(db, { userId: c.userId, creatorId: c.creatorId, trigger: "manual", now: NOW }),
    ).toEqual({
      ok: false,
      reason: "consent_required",
    });
    expect((await getPassport(db, c.userId))!.graph).toBeNull();

    const enabled = await enableProfessionalAnalytics(db, {
      userId: c.userId,
      consentDefinitionId: ANALYTICS_CONSENT,
      now: NOW,
    });
    expect(enabled).toMatchObject({ ok: true, reused: false });
    expect((await getPassport(db, c.userId))!.graph).not.toBeNull();

    await withdrawPurpose({ db }, { userId: c.userId, key: CONSENT_KEYS.professionalAnalytics, source: "settings" });
    expect((await getPassport(db, c.userId))!.graph).toBeNull();
    await expect(
      withdrawPurpose({ db }, { userId: c.userId, key: CONSENT_KEYS.professionalAnalytics, source: "settings" }),
    ).rejects.toMatchObject({ code: "not_granted" });
  });

  it("rejects the wrong consent purpose for analytics", async () => {
    const c = await completedCreator("wrong.consent.test");
    await expect(
      enableProfessionalAnalytics(db, { userId: c.userId, consentDefinitionId: CONNECT_CONSENT }),
    ).rejects.toMatchObject({ code: "definition_key_mismatch" });
  });
});

describe("Passport editing keeps verified data intact", () => {
  it("re-saving the profile keeps connected rows and refreshes the declared handle", async () => {
    const c = await completedCreator("edit.me.test");
    const state = await start(c.userId);
    const { accountId } = await completeConnection(deps(), { userId: c.userId, state, code: code("edit.me.test") });
    await saveProfileStep(
      db,
      c.userId,
      profileStepSchema.parse({
        primaryCreatorHandle: "edit.me.test",
        categories: ["fashion"],
        primaryCategory: "fashion",
        creatorSince: "2019-06",
        platforms: ["instagram", "linkedin"],
        platformHandles: { instagram: "edit.me.new", linkedin: "edit-me" },
      }),
      NOW,
      { mode: "passport" },
    );
    const rows = await db.select().from(creatorSocialAccounts).where(eq(creatorSocialAccounts.creatorId, c.creatorId));
    const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r]));
    expect(byPlatform.instagram).toMatchObject({
      id: accountId,
      connectionStatus: "connected",
      handle: "edit.me.test",
      declaredHandle: "edit.me.new",
    });
    expect(byPlatform.linkedin).toMatchObject({ connectionStatus: "declared", handle: "edit-me" });
    expect(byPlatform.youtube).toBeUndefined();
  });
});

describe("session channels", () => {
  it("accepts native/API sessions only as bearer tokens and web sessions only as cookies", async () => {
    const email = testEmail("channel");
    const up = await signUpCreator(auth, { email, password: "a long enough passphrase" });
    if (!up.ok) throw new Error("signup failed");
    const ios = await signIn(auth, { email, password: "a long enough passphrase", client: "ios" });
    if (!ios.ok) throw new Error("sign-in failed");

    expect(await resolveSession(auth, up.session.token)).not.toBeNull();
    expect(await resolveSession(auth, up.session.token, ["ios", "android", "api"])).toBeNull();
    expect(await resolveSession(auth, ios.session.token)).toBeNull();
    expect(await resolveSession(auth, ios.session.token, ["ios", "android", "api"])).toMatchObject({ email });
  });
});

describe("several accounts on one platform (Stage 11b)", () => {
  const accountsOf = (creatorId: string) =>
    db
      .select()
      .from(creatorSocialAccounts)
      .where(and(eq(creatorSocialAccounts.creatorId, creatorId), eq(creatorSocialAccounts.platform, "instagram")));

  it("adds extra accounts as their own rows without a declaration, keeps one primary, and caps at 3", async () => {
    const c = await completedCreator("multi.main.test");
    const first = await completeConnection(deps(), {
      userId: c.userId,
      state: await start(c.userId),
      code: code("multi.main.test"),
    });
    const second = await completeConnection(deps(), {
      userId: c.userId,
      state: await start(c.userId, { additional: true }),
      code: code("multi.second.test"),
    });
    expect(second.accountId).not.toBe(first.accountId);
    let rows = await accountsOf(c.creatorId);
    const main = rows.find((r) => r.id === first.accountId)!;
    const extra = rows.find((r) => r.id === second.accountId)!;
    expect(main).toMatchObject({ isPrimary: true, declaredHandle: "multi.main.test" });
    // No borrowed declaration, so no false "handle differs from declared" signal.
    expect(extra).toMatchObject({ isPrimary: false, declaredHandle: null, connectionStatus: "connected" });

    await completeConnection(deps(), {
      userId: c.userId,
      state: await start(c.userId, { additional: true }),
      code: code("multi.third.test"),
    });
    await expect(start(c.userId, { additional: true })).rejects.toMatchObject({ code: "account_limit" });

    // Switching the primary keeps exactly one.
    await setPrimaryAccount(db, { userId: c.userId, accountId: extra.id });
    rows = await accountsOf(c.creatorId);
    expect(rows.filter((r) => r.isPrimary).map((r) => r.id)).toEqual([extra.id]);

    // Disconnecting the primary (no declaration to fall back to) promotes another account.
    await disconnectAccount(deps(), { userId: c.userId, accountId: extra.id });
    rows = await accountsOf(c.creatorId);
    const active = rows.filter((r) => r.connectionStatus !== "disconnected");
    expect(active).toHaveLength(2);
    expect(active.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it("an extra account can't be added before the platform has a connected one", async () => {
    const c = await completedCreator("multi.none.test");
    // `additional` is ignored: the connection upgrades the self-declared row as usual.
    const r = await completeConnection(deps(), {
      userId: c.userId,
      state: await start(c.userId, { additional: true }),
      code: code("multi.none.test"),
    });
    const rows = await accountsOf(c.creatorId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.accountId, isPrimary: true, declaredHandle: "multi.none.test" });
  });
});
