import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { accessRequests, creatorPointsLedger } from "@/db/schema";
import { approveAccessRequest, declineAccessRequest, requestAccess } from "@/modules/access";
import { CONSENT_KEYS } from "@/modules/consent";
import { withdrawPurpose } from "@/modules/privacy";
import { getPointsBalance, getPointsSummary } from "@/modules/rewards";

import {
  ONYX_SIGNALS,
  accessMember,
  brandConsentId,
  giveSignals,
  opportunity,
  partnershipsAdmin,
} from "../support/access";
import { connectTestDb } from "../support/db";

/**
 * Stage 14 review fixes: concurrent Access work must never lose points, leave a
 * request alive after the consent is withdrawn, oversell places, or deadlock.
 * Each case races real transactions on separate connections.
 */
const { db } = connectTestDb();

const request = (userId: string, opportunityId: string, withConsent = true) =>
  requestAccess(db, {
    userId,
    opportunityId,
    consentDefinitionId: withConsent ? brandConsentId() : null,
    source: "settings",
  });

/** Ledger invariant: balance = earned − holds not released; never negative. */
async function assertLedgerConsistent(creatorId: string) {
  const ledger = await db.select().from(creatorPointsLedger).where(eq(creatorPointsLedger.creatorId, creatorId));
  const releases = ledger.filter((e) => e.entryType === "release");
  for (const r of releases) {
    const hold = ledger.find((e) => e.entryType === "hold" && e.accessRequestId === r.accessRequestId);
    expect(hold, "every release pairs with a hold").toBeDefined();
    expect(r.amount).toBe(-hold!.amount);
  }
  const balance = await getPointsBalance(db, creatorId);
  expect(balance).toBe(ledger.reduce((s, e) => s + e.amount, 0));
  expect(balance).toBeGreaterThanOrEqual(0);
  return balance;
}

describe("Access concurrency (Stage 14)", () => {
  it("a withdrawal racing a request never loses points or leaves a request alive — in either order", async () => {
    const staff = await partnershipsAdmin(db);
    const outcomes = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const m = await accessMember(db, `race-w${i}`);
      const warmup = await opportunity(db, staff, { pointsCost: 0 });
      await request(m.userId, warmup); // grants the consent
      const opp = await opportunity(db, staff, { pointsCost: 200 });

      const withdraw = () =>
        withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.brandOpportunities, source: "settings" });
      // Alternate who starts first; the request relies on the existing consent (it doesn't re-grant it).
      const [r] =
        i % 2 === 0
          ? await Promise.all([request(m.userId, opp, false), withdraw()])
          : await Promise.all([withdraw(), request(m.userId, opp, false)]).then(([w, r2]) => [r2, w] as const);
      outcomes.add(r.ok ? "request_first" : r.reason);

      // Whatever the order: no request survives, every point is back.
      const left = await db.select().from(accessRequests).where(eq(accessRequests.creatorId, m.creatorId));
      expect(left).toEqual([]);
      expect(await assertLedgerConsistent(m.creatorId)).toBe(500);
      expect((await getPointsSummary(db, m.creatorId)).held).toBe(0);
    }
    // Both interleavings are acceptable; at least one must have been exercised.
    for (const o of outcomes) expect(["request_first", "consent_required"]).toContain(o);
  });

  it("a re-request racing a decline keeps one live request and a consistent ledger", async () => {
    const staff = await partnershipsAdmin(db);
    for (let i = 0; i < 4; i++) {
      const m = await accessMember(db, `race-d${i}`);
      const opp = await opportunity(db, staff, { pointsCost: 150 });
      const first = (await request(m.userId, opp)) as { requestId: string };
      await Promise.allSettled([
        declineAccessRequest(db, { requestId: first.requestId, staffUserId: staff, reason: "other" }),
        request(m.userId, opp),
      ]);
      const live = await db
        .select()
        .from(accessRequests)
        .where(
          and(eq(accessRequests.creatorId, m.creatorId), inArray(accessRequests.status, ["requested", "approved"])),
        );
      expect(live.length).toBeLessThanOrEqual(1);
      const balance = await assertLedgerConsistent(m.creatorId);
      expect(balance).toBe(500 - live.reduce((s, r) => s + r.pointsHeld, 0));
    }
  });

  it("two approvals racing for the last place: exactly one wins", async () => {
    const staff = await partnershipsAdmin(db);
    const opp = await opportunity(db, staff, { pointsCost: 0, places: 1 });
    const a = await accessMember(db, "race-p1");
    const b = await accessMember(db, "race-p2");
    const ra = (await request(a.userId, opp)) as { requestId: string };
    const rb = (await request(b.userId, opp)) as { requestId: string };
    const results = await Promise.allSettled([
      approveAccessRequest(db, { requestId: ra.requestId, staffUserId: staff }),
      approveAccessRequest(db, { requestId: rb.requestId, staffUserId: staff }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "full" });
    const approved = await db
      .select()
      .from(accessRequests)
      .where(and(eq(accessRequests.opportunityId, opp), eq(accessRequests.status, "approved")));
    expect(approved).toHaveLength(1);
  });

  it("concurrent requests can't overspend the balance", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "race-spend");
    await giveSignals(db, m.creatorId, ONYX_SIGNALS); // 1,500
    await request(m.userId, await opportunity(db, staff, { pointsCost: 0 })); // consent
    const opps = await Promise.all([1, 2, 3].map(() => opportunity(db, staff, { pointsCost: 700 })));
    const results = await Promise.all(opps.map((o) => request(m.userId, o)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "insufficient_points" }]);
    expect(await assertLedgerConsistent(m.creatorId)).toBe(100);
  });
});
