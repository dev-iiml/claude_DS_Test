import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { creatorPointsLedger, creatorProfiles } from "@/db/schema";
import { completeAccessRequest, decideAccessRequest, requestAccess } from "@/modules/access";
import { CONSENT_KEYS } from "@/modules/consent";
import {
  getPointsSummary,
  grantMembershipMilestones,
  pointsBalance,
  reversePoints,
} from "@/modules/rewards/ledger-service";
import { completeTask, decideTask, listTasksForCreator, proposeTask } from "@/modules/rewards/tasks-service";

import { connectTestDb } from "../support/db";
import { completedMember, consentDef, staffUser, testOpportunity } from "../support/members";

const { db } = connectTestDb();

describe("Creator Points v0.2 (pts-0.2.0)", () => {
  it("profile details earn points once — only when the typed-in details are complete", async () => {
    const partial = await completedMember(db, { interests: false });
    expect(await pointsBalance(db, partial.creatorId)).toBe(500);
    const full = await completedMember(db, { interests: true });
    expect(await pointsBalance(db, full.creatorId)).toBe(750);
    const summary = await getPointsSummary(db, full.creatorId);
    expect(summary.history.map((h) => h.label)).toContain("Completed your profile details");
  });

  it("membership anniversaries are granted once per year by the daily sweep", async () => {
    const m = await completedMember(db);
    const since = new Date("2024-01-15T00:00:00Z");
    await db.update(creatorProfiles).set({ completedAt: since }).where(eq(creatorProfiles.id, m.creatorId));
    const now = new Date("2026-02-01T00:00:00Z");
    await grantMembershipMilestones({ db, now });
    await grantMembershipMilestones({ db, now });
    expect(await pointsBalance(db, m.creatorId)).toBe(500 + 2 * 300);
    const labels = (await getPointsSummary(db, m.creatorId)).history.map((h) => h.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Membership anniversary (year 1)", "Membership anniversary (year 2)"]),
    );
  });

  it("staff tasks need a second admin, block consent/credit wording, and pay once per creator", async () => {
    const a = await staffUser(db, "partnerships_admin");
    const b = await staffUser(db, "partnerships_admin");
    await expect(
      proposeTask(db, {
        staffUserId: a,
        title: "Renew your consent",
        description: "Renew your bank-data consent to earn points.",
        category: "community",
        points: 100,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    const task = await proposeTask(db, {
      staffUserId: a,
      title: "Join a creator meetup",
      description: "Attend a CreatorCo community meetup; the host confirms attendance.",
      category: "community",
      points: 200,
    });
    const m = await completedMember(db);
    expect(await listTasksForCreator(db, m.creatorId)).toEqual([]);
    await expect(decideTask(db, { staffUserId: a, taskId: task.id, decision: "approve" })).rejects.toMatchObject({
      code: "four_eyes",
    });
    await decideTask(db, { staffUserId: b, taskId: task.id, decision: "approve" });
    expect((await listTasksForCreator(db, m.creatorId)).map((t) => t.title)).toEqual(["Join a creator meetup"]);

    await expect(
      completeTask(db, { staffUserId: a, taskId: task.id, creatorHandle: m.handle, note: "PAN ABCDE1234F" }),
    ).rejects.toMatchObject({ code: "invalid" });
    await completeTask(db, { staffUserId: a, taskId: task.id, creatorHandle: `@${m.handle}`, note: "Host confirmed" });
    await expect(
      completeTask(db, { staffUserId: b, taskId: task.id, creatorHandle: m.handle, note: null }),
    ).rejects.toMatchObject({ code: "already_completed" });
    expect(await pointsBalance(db, m.creatorId)).toBe(700);
    expect((await getPointsSummary(db, m.creatorId)).history[0]).toMatchObject({
      type: "earned",
      amount: 200,
      label: "Task: Join a creator meetup",
    });
    expect((await listTasksForCreator(db, m.creatorId))[0]!.completedAt).not.toBeNull();
  });

  it("completing an approved Access request earns the participation points once", async () => {
    const staff = await staffUser(db, "partnerships_admin");
    const m = await completedMember(db);
    const opp = await testOpportunity(db, staff, { pointsCost: 0 });
    await requestAccess(db, {
      userId: m.userId,
      opportunityId: opp,
      note: null,
      consentDefinitionId: consentDef(CONSENT_KEYS.brandOpportunities),
      source: "settings",
    });
    const [req] = await db
      .select({ id: creatorPointsLedger.id })
      .from(creatorPointsLedger)
      .where(eq(creatorPointsLedger.creatorId, m.creatorId));
    expect(req).toBeDefined();
    const { listRequestsForCreator } = await import("@/modules/access");
    const request = (await listRequestsForCreator(db, m.userId))[0]!;
    await expect(completeAccessRequest(db, { staffUserId: staff, requestId: request.id })).rejects.toMatchObject({
      code: "wrong_state",
    });
    await decideAccessRequest(db, { staffUserId: staff, requestId: request.id, decision: { decision: "approve" } });
    expect(await completeAccessRequest(db, { staffUserId: staff, requestId: request.id })).toEqual({ completed: true });
    expect(await completeAccessRequest(db, { staffUserId: staff, requestId: request.id })).toEqual({
      completed: false,
    });
    expect(await pointsBalance(db, m.creatorId)).toBe(500 + 150);
    expect((await listRequestsForCreator(db, m.userId))[0]!.completedAt).not.toBeNull();
  });

  it("a reversal removes an earn once, cancels holds first, and floors at zero", async () => {
    const staff = await staffUser(db, "partnerships_admin");
    const m = await completedMember(db);
    const opp = await testOpportunity(db, staff, { pointsCost: 400 });
    await requestAccess(db, {
      userId: m.userId,
      opportunityId: opp,
      note: null,
      consentDefinitionId: consentDef(CONSENT_KEYS.brandOpportunities),
      source: "settings",
    });
    expect(await getPointsSummary(db, m.creatorId)).toMatchObject({ balance: 100, onHold: 400 });
    const r1 = await db.transaction((tx) =>
      reversePoints(tx, { creatorId: m.creatorId, earnKey: "welcome", reason: "test" }),
    );
    expect(r1).toEqual({ reversed: 500, flooredBy: 0 });
    expect(await pointsBalance(db, m.creatorId)).toBe(0);
    const r2 = await db.transaction((tx) =>
      reversePoints(tx, { creatorId: m.creatorId, earnKey: "welcome", reason: "test" }),
    );
    expect(r2).toEqual({ reversed: 0, flooredBy: 0 });
    expect((await getPointsSummary(db, m.creatorId)).history).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "reversed", label: "Reversed: Welcome to CreatorCo" })]),
    );
    const { listRequestsForCreator } = await import("@/modules/access");
    expect((await listRequestsForCreator(db, m.userId))[0]!.status).toBe("cancelled");
  });
});
