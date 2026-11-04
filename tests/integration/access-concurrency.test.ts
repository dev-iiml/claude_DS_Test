import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { accessRequests, brands, creatorPointsLedger, creatorProfiles, users } from "@/db/schema";
import { createOpportunity, decideAccessRequest, requestAccess } from "@/modules/access";
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
import { withdrawPurpose } from "@/modules/privacy";
import { getPointsSummary } from "@/modules/rewards/ledger-service";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

/**
 * Interleavings the single-threaded tests can't reach (independent review, Stage 14). A third
 * connection holds a lock so one transaction stalls mid-way while the other runs; afterwards the
 * points ledger must still add up and no request may outlive a withdrawn consent.
 */
const { db } = connectTestDb();
const auth = authDepsFor(db);
const def = (key: string) => CONSENT_DEFINITION_SEEDS.find((d) => d.key === key)!.id;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

async function member(handle: string) {
  const r = await signUpCreator(auth, { email: testEmail("race"), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Mira Iyer",
      displayName: "Mira",
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
    // No interests: the "profile details" milestone (pts-0.2.0) stays unearned, so balances start at the welcome 500.
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

async function setup(label: string) {
  const s = await signUpCreator(auth, { email: testEmail("staff"), password: "a long enough passphrase" });
  if (!s.ok) throw new Error("signup failed");
  await db.update(users).set({ role: "partnerships_admin" }).where(eq(users.id, s.user.userId));
  const [b] = await db
    .insert(brands)
    .values({ name: `Race Brand ${label} ${Date.now()}`, category: "Beauty" })
    .returning({ id: brands.id });
  const now = Date.now();
  const opportunity = (pointsCost: number) =>
    createOpportunity(db, {
      staffUserId: s.user.userId,
      values: {
        brandId: b!.id,
        title: "Race Drop",
        kind: "pr_drop",
        category: "Beauty",
        summary: "A race test.",
        details: "A race test.",
        minTier: "member",
        pointsCost,
        seats: 5,
        opensAt: new Date(now - DAY),
        closesAt: new Date(now + 5 * DAY),
        status: "live",
      },
    });
  return { staffId: s.user.userId, opportunity };
}

/** Holds a lock on a third connection until released. */
function blocker(statement: (q: postgres.TransactionSql) => Promise<unknown>) {
  const conn = postgres(process.env.DATABASE_URL_TEST!, { max: 1 });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const done = conn.begin(async (q) => {
    await statement(q);
    await gate;
  });
  return {
    async release() {
      release();
      await done;
      await conn.end();
    },
  };
}

const settle = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error: error as { code?: string; cause?: { code?: string } } }),
  );

/** Every hold is either released or stands for an approved request. */
async function ledgerAddsUp(creatorId: string, userId: string) {
  const entries = await db.select().from(creatorPointsLedger).where(eq(creatorPointsLedger.creatorId, creatorId));
  const requests = await db.select().from(accessRequests).where(eq(accessRequests.userId, userId));
  for (const hold of entries.filter((e) => e.entryType === "hold")) {
    const released = entries.some((e) => e.entryType === "release" && e.requestId === hold.requestId);
    const request = requests.find((r) => r.id === hold.requestId);
    expect(released || request?.status === "approved" || request?.status === "requested").toBe(true);
  }
}

describe("Access under concurrency", () => {
  it("a withdrawal that lands while a request is in flight cancels it and returns the points", async () => {
    const { opportunity } = await setup("a");
    const first = await opportunity(100);
    const second = await opportunity(200);
    const m = await member(`race.a.${Date.now()}`);
    await requestAccess(db, {
      userId: m.userId,
      opportunityId: first,
      note: null,
      consentDefinitionId: def(CONSENT_KEYS.brandOpportunities),
      source: "api",
    });
    // Stall the request after it has taken its locks (its audit insert waits).
    const block = blocker((q) => q`lock table audit_events in share mode`);
    await sleep(200);
    const request = settle(
      requestAccess(db, { userId: m.userId, opportunityId: second, note: "secret note", source: "api" }),
    );
    await sleep(300);
    const withdrawal = settle(
      withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.brandOpportunities, source: "settings" }),
    );
    await sleep(300);
    await block.release();
    const [r, w] = await Promise.all([request, withdrawal]);
    expect(w.ok).toBe(true);
    expect(r.ok).toBe(true);
    expect(await db.select().from(accessRequests).where(eq(accessRequests.userId, m.userId))).toEqual([]);
    expect(await getPointsSummary(db, m.creatorId, 0)).toMatchObject({ balance: 500, onHold: 0 });
    await ledgerAddsUp(m.creatorId, m.userId);
  });

  it("a request that arrives while a withdrawal is in flight is refused", async () => {
    const { opportunity } = await setup("b");
    const first = await opportunity(100);
    const second = await opportunity(200);
    const m = await member(`race.b.${Date.now()}`);
    await requestAccess(db, {
      userId: m.userId,
      opportunityId: first,
      note: null,
      consentDefinitionId: def(CONSENT_KEYS.brandOpportunities),
      source: "api",
    });
    const block = blocker((q) => q`lock table audit_events in share mode`);
    await sleep(200);
    const withdrawal = settle(
      withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.brandOpportunities, source: "settings" }),
    );
    await sleep(300);
    const request = settle(
      requestAccess(db, { userId: m.userId, opportunityId: second, note: "secret note", source: "api" }),
    );
    await sleep(300);
    await block.release();
    const [w, r] = await Promise.all([withdrawal, request]);
    expect(w.ok).toBe(true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("consent_required");
    expect(await db.select().from(accessRequests).where(eq(accessRequests.userId, m.userId))).toEqual([]);
    expect(await getPointsSummary(db, m.creatorId, 0)).toMatchObject({ balance: 500, onHold: 0 });
    await ledgerAddsUp(m.creatorId, m.userId);
  });

  it("a re-request racing a decline never deadlocks", async () => {
    const { staffId, opportunity } = await setup("c");
    const id = await opportunity(100);
    const m = await member(`race.c.${Date.now()}`);
    const r = await requestAccess(db, {
      userId: m.userId,
      opportunityId: id,
      note: null,
      consentDefinitionId: def(CONSENT_KEYS.brandOpportunities),
      source: "api",
    });
    const block = blocker((q) => q`select 1 from access_requests where id = ${r.requestId} for update`);
    await sleep(200);
    const decline = settle(
      decideAccessRequest(db, {
        staffUserId: staffId,
        requestId: r.requestId,
        decision: { decision: "decline", reason: "other" },
      }),
    );
    await sleep(300);
    const again = settle(requestAccess(db, { userId: m.userId, opportunityId: id, note: null, source: "api" }));
    await sleep(300);
    await block.release();
    const [d, a] = await Promise.all([decline, again]);
    const deadlocked = [d, a].some((x) => !x.ok && (x.error.code === "40P01" || x.error.cause?.code === "40P01"));
    expect(deadlocked).toBe(false);
    expect(d.ok).toBe(true);
    await ledgerAddsUp(m.creatorId, m.userId);
  });

  it("two approvals racing for the last place approve only one", async () => {
    const { staffId, opportunity } = await setup("d");
    const id = await opportunity(0);
    // One place left.
    await db.execute(sql`update access_opportunities set seats = 1 where id = ${id}`);
    const a = await member(`race.d1.${Date.now()}`);
    const b = await member(`race.d2.${Date.now()}`);
    const ask = (userId: string) =>
      requestAccess(db, {
        userId,
        opportunityId: id,
        note: null,
        consentDefinitionId: def(CONSENT_KEYS.brandOpportunities),
        source: "api",
      });
    const [ra, rb] = [await ask(a.userId), await ask(b.userId)];
    const results = await Promise.all(
      [ra, rb].map((r) =>
        settle(
          decideAccessRequest(db, { staffUserId: staffId, requestId: r.requestId, decision: { decision: "approve" } }),
        ),
      ),
    );
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok).map((x) => !x.ok && x.error.code)).toEqual(["full"]);
  });
});
