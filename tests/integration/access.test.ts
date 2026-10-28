import { and, count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { accessRequests, auditEvents, consentReceipts, creatorPointsLedger, creatorStatusRuns } from "@/db/schema";
import {
  AccessError,
  approveAccessRequest,
  cancelAccessRequest,
  closeOpportunity,
  declineAccessRequest,
  expireAccessRequests,
  getOpportunityForCreator,
  getRequestForDesk,
  listAccessQueue,
  listOpportunitiesForCreator,
  requestAccess,
  updateOpportunity,
} from "@/modules/access";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { getCurrentCreatorStatus } from "@/modules/creator-status";
import { withdrawPurpose } from "@/modules/privacy";
import { getLatestProfessionalGraph } from "@/modules/professional-graph/graph-service";
import { getPointsBalance, getPointsSummary } from "@/modules/rewards";
import { completeConnection, startConnection } from "@/modules/social-data/connection-service";
import { MockSocialDataProvider, encodeMockCode } from "@/providers/social/mock-social-data-provider";

import {
  ICON_SIGNALS,
  ONYX_SIGNALS,
  accessMember,
  brandConsentId,
  def,
  giveSignals,
  opportunity,
  partnershipsAdmin,
} from "../support/access";
import { connectTestDb } from "../support/db";

const { db } = connectTestDb();

const request = (userId: string, opportunityId: string, extra: { note?: string; withConsent?: boolean } = {}) =>
  requestAccess(db, {
    userId,
    opportunityId,
    note: extra.note,
    consentDefinitionId: extra.withConsent === false ? null : brandConsentId(),
    source: "settings",
  });

const ledgerOf = (creatorId: string) =>
  db.select().from(creatorPointsLedger).where(eq(creatorPointsLedger.creatorId, creatorId));

describe("Creator Status (Stage 14)", () => {
  it("starts at Member; Onyx and Icon follow the signals and grant one-off points", async () => {
    const m = await accessMember(db, "status");
    expect((await getCurrentCreatorStatus(db, m.creatorId)).tier).toBe("member");
    expect(await getPointsBalance(db, m.creatorId)).toBe(500); // welcome only (no verified mobile)

    const onyx = await giveSignals(db, m.creatorId, ONYX_SIGNALS);
    expect(onyx.tier).toBe("onyx");
    expect(await getPointsBalance(db, m.creatorId)).toBe(1_500);

    // The same graph run is never recalculated into a second status.
    const again = await refresh(m.creatorId, onyx.graphRunId);
    expect(again).toMatchObject({ statusRunId: onyx.statusRunId, reused: true });

    await giveSignals(db, m.creatorId, ICON_SIGNALS);
    expect(await getPointsBalance(db, m.creatorId)).toBe(4_000);

    // Dropping back takes nothing away, and the tier grants are never repeated.
    await giveSignals(db, m.creatorId, { total_audience: 5_000_000 });
    expect((await getCurrentCreatorStatus(db, m.creatorId)).tier).toBe("member");
    await giveSignals(db, m.creatorId, ICON_SIGNALS);
    expect(await getPointsBalance(db, m.creatorId)).toBe(4_000);
    const milestones = (await ledgerOf(m.creatorId)).map((e) => e.milestone).sort();
    expect(milestones).toEqual(["tier_icon", "tier_onyx", "welcome"]);
  });

  it("stores the full checklist, and is erased with the signals it came from", async () => {
    const m = await accessMember(db, "status-erase");
    await giveSignals(db, m.creatorId, ONYX_SIGNALS);
    const current = await getCurrentCreatorStatus(db, m.creatorId);
    expect(current).toMatchObject({ tier: "onyx", rulesVersion: "cs-0.1.0" });
    expect(current.checklists.map((c) => c.tier)).toEqual(["onyx", "icon"]);
    expect(current.checklists[1]!.criteria.find((c) => c.criterion === "reach")).toMatchObject({
      met: false,
      value: 60_000,
      threshold: 250_000,
    });

    // Professional analytics was never granted here, but a withdrawal of social data / signals erases the graph.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local creatorco.erasure = 'on'`);
      await tx.execute(sql`delete from professional_graph_runs where creator_id = ${m.creatorId}`);
    });
    const runs = await db
      .select({ n: count() })
      .from(creatorStatusRuns)
      .where(eq(creatorStatusRuns.creatorId, m.creatorId));
    expect(runs[0]!.n).toBe(0);
    expect((await getCurrentCreatorStatus(db, m.creatorId)).tier).toBe("member");
    // Points already granted stay.
    expect(await getPointsBalance(db, m.creatorId)).toBe(1_500);
  });

  it("is calculated after every Professional Graph run (real connection through the mock provider)", async () => {
    const m = await accessMember(db, "status-hook");
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
      code: encodeMockCode({ platform: "instagram", handle: "status.hook.demo", nonce: "n" }),
    });
    const graph = await getLatestProfessionalGraph(db, m.creatorId);
    const [run] = await db.select().from(creatorStatusRuns).where(eq(creatorStatusRuns.graphRunId, graph!.runId));
    expect(run).toMatchObject({ creatorId: m.creatorId, rulesVersion: "cs-0.1.0" });
    expect((await getCurrentCreatorStatus(db, m.creatorId)).rulesVersion).toBe("cs-0.1.0");
  });

  it("keeps status runs and the ledger append-only", async () => {
    const m = await accessMember(db, "status-guard");
    await giveSignals(db, m.creatorId, ONYX_SIGNALS);
    await expect(
      db.execute(sql`update creator_status_runs set tier = 'icon' where creator_id = ${m.creatorId}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from creator_status_runs where creator_id = ${m.creatorId}`)).rejects.toThrow();
    await expect(
      db.execute(sql`update creator_points_ledger set amount = 99999 where creator_id = ${m.creatorId}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from creator_points_ledger where creator_id = ${m.creatorId}`),
    ).rejects.toThrow();
    // The database also refuses a hold with a positive amount.
    await expect(
      db.insert(creatorPointsLedger).values({
        creatorId: m.creatorId,
        entryType: "hold",
        amount: 10,
        accessRequestId: m.creatorId,
        rulesVersion: "pts-0.1.0",
      }),
    ).rejects.toThrow();
  });
});

async function refresh(creatorId: string, graphRunId: string) {
  const { refreshCreatorStatus } = await import("@/modules/creator-status/status-service");
  return refreshCreatorStatus(db, { creatorId, graphRunId });
}

describe("Access requests (Stage 14)", () => {
  it("asks for the Brand opportunities consent at the first request and holds the points", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "req");
    const opp = await opportunity(db, staff, { pointsCost: 300 });

    expect(await request(m.userId, opp, { withConsent: false })).toEqual({ ok: false, reason: "consent_required" });
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.brandOpportunities)).toBe(false);

    const r = await request(m.userId, opp, { note: "  I review skincare every week.  " });
    expect(r).toMatchObject({ ok: true, pointsHeld: 300 });
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.brandOpportunities)).toBe(true);
    const [row] = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, (r as { requestId: string }).requestId));
    expect(row).toMatchObject({ status: "requested", note: "I review skincare every week.", pointsHeld: 300 });

    const summary = await getPointsSummary(db, m.creatorId);
    expect(summary).toMatchObject({ balance: 200, held: 300 });
    expect(summary.activity[0]).toMatchObject({ type: "hold", points: -300, label: "Held for an Access request" });

    // Later requests reuse the consent; a second live request for the same opportunity is refused.
    expect(await request(m.userId, opp, { withConsent: false })).toEqual({ ok: false, reason: "already_requested" });
    const receipts = await db.select({ n: count() }).from(consentReceipts).where(eq(consentReceipts.userId, m.userId));
    expect(receipts[0]!.n).toBe(2); // creator profile + brand opportunities

    // The audit record is minimal: no opportunity, no note.
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.eventType, "access.requested"), eq(auditEvents.entityId, row!.id)));
    expect(audit!.metadata).toEqual({ points: 300 });
  });

  it("refuses by tier, points and window — and a refusal changes nothing", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "refuse");
    const onyxOnly = await opportunity(db, staff, { minTier: "onyx", pointsCost: 100 });
    const pricey = await opportunity(db, staff, { pointsCost: 900 });
    const later = await opportunity(db, staff, { opensAt: new Date("2029-01-01T00:00:00Z") });

    expect(await request(m.userId, onyxOnly)).toEqual({ ok: false, reason: "tier_required" });
    expect(await request(m.userId, pricey)).toEqual({ ok: false, reason: "insufficient_points" });
    expect(await request(m.userId, later)).toEqual({ ok: false, reason: "not_open" });
    // The consent offered with a refused request isn't recorded either.
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.brandOpportunities)).toBe(false);
    expect(await getPointsBalance(db, m.creatorId)).toBe(500);

    await giveSignals(db, m.creatorId, ONYX_SIGNALS);
    expect(await request(m.userId, onyxOnly)).toMatchObject({ ok: true });
  });

  it("approve spends, decline and cancel return; a declined opportunity can be requested again", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "decide");
    await giveSignals(db, m.creatorId, ONYX_SIGNALS); // 1,500 points
    const a = await opportunity(db, staff, { pointsCost: 400 });
    const b = await opportunity(db, staff, { pointsCost: 300 });
    const c = await opportunity(db, staff, { pointsCost: 200 });

    const ra = (await request(m.userId, a)) as { requestId: string };
    const rb = (await request(m.userId, b)) as { requestId: string };
    const rc = (await request(m.userId, c)) as { requestId: string };
    expect(await getPointsBalance(db, m.creatorId)).toBe(600);

    await approveAccessRequest(db, { requestId: ra.requestId, staffUserId: staff });
    await declineAccessRequest(db, { requestId: rb.requestId, staffUserId: staff, reason: "not_a_fit" });
    expect(await cancelAccessRequest(db, { userId: m.userId, requestId: rc.requestId })).toEqual({
      ok: true,
      pointsReturned: 200,
    });
    expect(await getPointsSummary(db, m.creatorId)).toMatchObject({ balance: 1_100, held: 0 });

    // Decisions are final.
    await expect(
      declineAccessRequest(db, { requestId: ra.requestId, staffUserId: staff, reason: "other" }),
    ).rejects.toThrow(AccessError);
    expect(await cancelAccessRequest(db, { userId: m.userId, requestId: rb.requestId })).toEqual({
      ok: false,
      reason: "not_pending",
    });
    // …and the database agrees.
    await expect(
      db.execute(
        sql`update access_requests set status = 'declined', decline_reason = 'other' where id = ${ra.requestId}`,
      ),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from access_requests where id = ${ra.requestId}`)).rejects.toThrow();

    const view = await getOpportunityForCreator(db, { creatorId: m.creatorId, opportunityId: b });
    expect(view!.myRequest).toMatchObject({ status: "declined", declineReason: "not_a_fit" });
    expect(view!.canRequest).toEqual({ ok: true });
    expect(await request(m.userId, b)).toMatchObject({ ok: true });

    const activity = (await getPointsSummary(db, m.creatorId)).activity.map((x) => x.label);
    expect(activity).toContain("Spent on an Access request");
    expect(activity).toContain("Returned from an Access request");
  });

  it("enforces places, and places can't be cut below approvals", async () => {
    const staff = await partnershipsAdmin(db);
    const opp = await opportunity(db, staff, { pointsCost: 0, places: 1 });
    const m1 = await accessMember(db, "places1");
    const m2 = await accessMember(db, "places2");
    const r1 = (await request(m1.userId, opp)) as { requestId: string };
    const r2 = (await request(m2.userId, opp)) as { requestId: string };
    await approveAccessRequest(db, { requestId: r1.requestId, staffUserId: staff });
    await expect(approveAccessRequest(db, { requestId: r2.requestId, staffUserId: staff })).rejects.toMatchObject({
      code: "full",
    });
    const m3 = await accessMember(db, "places3");
    expect(await request(m3.userId, opp)).toEqual({ ok: false, reason: "full" });

    const base = {
      brandName: "Fictional Brand",
      title: "Sample opportunity",
      kind: "pr_drop" as const,
      category: "Beauty",
      summary: "A sample opportunity used only in tests.",
      minTier: "member" as const,
      pointsCost: 0,
      opensAt: new Date("2026-01-01T00:00:00Z"),
      closesAt: new Date("2030-01-01T00:00:00Z"),
    };
    await updateOpportunity(db, { staffUserId: staff, opportunityId: opp, values: { ...base, places: 3 } });
    await approveAccessRequest(db, { requestId: r2.requestId, staffUserId: staff });
    await expect(
      updateOpportunity(db, { staffUserId: staff, opportunityId: opp, values: { ...base, places: 1 } }),
    ).rejects.toMatchObject({ code: "places_below_approved" });
  });

  it("expires undecided requests at their deadline or when the opportunity closes, returning points", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "expiry");
    const soon = await opportunity(db, staff, { pointsCost: 100 });
    const closing = await opportunity(db, staff, { pointsCost: 150 });
    const r1 = (await request(m.userId, soon)) as { requestId: string };
    await request(m.userId, closing);
    expect(await getPointsBalance(db, m.creatorId)).toBe(250);

    await closeOpportunity(db, { staffUserId: staff, opportunityId: closing });
    expect(await request(m.userId, closing)).toEqual({ ok: false, reason: "not_open" });
    const first = await expireAccessRequests({ db });
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(await getPointsBalance(db, m.creatorId)).toBe(400);

    // Fourteen days later the other one expires too; a staff decision afterwards is refused.
    const [row] = await db.select().from(accessRequests).where(eq(accessRequests.id, r1.requestId));
    await expireAccessRequests({ db, now: new Date(row!.expiresAt.getTime() + 1) });
    expect(await getPointsBalance(db, m.creatorId)).toBe(500);
    const [after] = await db.select().from(accessRequests).where(eq(accessRequests.id, r1.requestId));
    expect(after!.status).toBe("expired");
    await expect(approveAccessRequest(db, { requestId: r1.requestId, staffUserId: staff })).rejects.toMatchObject({
      code: "not_pending",
    });
  });

  it("pausing membership cancels pending requests and returns their points", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "pause");
    const opp = await opportunity(db, staff, { pointsCost: 250 });
    await request(m.userId, opp);
    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.creatorProfile, source: "settings" },
    );
    expect(result.effects).toMatchObject({ membership_paused: true, access_requests_cancelled: 1 });
    expect(await getPointsBalance(db, m.creatorId)).toBe(500);
    const [row] = await db.select().from(accessRequests).where(eq(accessRequests.creatorId, m.creatorId));
    expect(row).toMatchObject({ status: "cancelled", cancelReason: "membership_paused" });
    expect(await request(m.userId, opp)).toEqual({ ok: false, reason: "profile_inactive" });
  });

  it("withdrawing Brand opportunities cancels, returns points and erases request history; the ledger stays", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "withdraw");
    await giveSignals(db, m.creatorId, ONYX_SIGNALS); // 1,500
    const a = await opportunity(db, staff, { pointsCost: 300 });
    const b = await opportunity(db, staff, { pointsCost: 200 });
    const ra = (await request(m.userId, a)) as { requestId: string };
    await request(m.userId, b);
    await approveAccessRequest(db, { requestId: ra.requestId, staffUserId: staff });

    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.brandOpportunities, source: "settings" },
    );
    expect(result.effects).toMatchObject({ access_requests_cancelled: 1 });
    expect(result.erasures).toEqual([{ scope: "access_requests", status: "completed", holdReasons: [] }]);
    const left = await db.select({ n: count() }).from(accessRequests).where(eq(accessRequests.creatorId, m.creatorId));
    expect(left[0]!.n).toBe(0);
    // Spent stays spent, the pending hold came back.
    expect(await getPointsSummary(db, m.creatorId)).toMatchObject({ balance: 1_200, held: 0 });
    // The minimal audit trail remains.
    const events = await db
      .select({ type: auditEvents.eventType })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, ra.requestId));
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["access.requested", "access.approved"]));

    // Browsing still works; requesting asks for the consent again.
    expect((await listOpportunitiesForCreator(db, { creatorId: m.creatorId })).length).toBeGreaterThan(0);
    expect(await request(m.userId, b, { withConsent: false })).toEqual({ ok: false, reason: "consent_required" });
  });

  it("the desk sees a creator-professional summary only, and viewing is audited", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "desk");
    await giveSignals(db, m.creatorId, ONYX_SIGNALS);
    const opp = await opportunity(db, staff);
    const r = (await request(m.userId, opp, { note: "Would love to." })) as { requestId: string };

    const queue = await listAccessQueue(db, { status: "requested" });
    expect(queue.find((q) => q.requestId === r.requestId)).toMatchObject({ creatorDisplayName: "Meera Makes" });

    const detail = await getRequestForDesk(db, { requestId: r.requestId, staffUserId: staff });
    expect(detail!.creator).toMatchObject({ displayName: "Meera Makes", tier: "onyx", city: "Kochi" });
    expect(Object.keys(detail!.creator).sort()).toEqual(
      ["category", "city", "displayName", "handle", "platforms", "signals", "tier"].sort(),
    );
    expect(detail!.creator.signals.map((s) => s.key)).not.toContain("follower_spike_detected");
    expect(JSON.stringify(detail)).not.toMatch(/legalName|pan|gstin|mobile|eligib|fraud/i);
    const viewed = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.eventType, "access.request_viewed"), eq(auditEvents.entityId, r.requestId)));
    expect(viewed).toHaveLength(1);
  });

  it("keeps the ledger consistent: balance = earned − spent − held", async () => {
    const staff = await partnershipsAdmin(db);
    const m = await accessMember(db, "invariant");
    await giveSignals(db, m.creatorId, ICON_SIGNALS); // 500 + 1,000 + 2,500
    const ids = await Promise.all([100, 200, 300, 400].map((cost) => opportunity(db, staff, { pointsCost: cost })));
    const reqs = [];
    for (const id of ids) reqs.push((await request(m.userId, id)) as { requestId: string });
    await approveAccessRequest(db, { requestId: reqs[0]!.requestId, staffUserId: staff });
    await declineAccessRequest(db, { requestId: reqs[1]!.requestId, staffUserId: staff, reason: "places_filled" });
    await cancelAccessRequest(db, { userId: m.userId, requestId: reqs[2]!.requestId });

    const ledger = await ledgerOf(m.creatorId);
    const earned = ledger.filter((e) => e.entryType === "earn").reduce((s, e) => s + e.amount, 0);
    const summary = await getPointsSummary(db, m.creatorId);
    expect(earned).toBe(4_000);
    expect(summary.held).toBe(400);
    expect(summary.balance).toBe(earned - 100 - 400);
    expect(summary.balance).toBeGreaterThanOrEqual(0);
  });
});
