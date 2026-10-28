import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { accessRequests, creatorPointsLedger, creatorProfiles, creatorStatusRuns, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { DEFAULT_CREATOR_STATUS, type CreatorStatusTier } from "@/modules/creator-status/status";

import {
  MILESTONE_LABELS,
  MILESTONE_POINTS,
  POINTS_RULES_VERSION,
  milestonesDue,
  type PointsEntryType,
  type PointsMilestone,
} from "./domain";

/**
 * Creator Points ledger service (Stage 14). Append-only entries; the balance
 * is their sum. Anything that checks a balance and then holds points first
 * calls `lockPointsAccount` in the same transaction.
 */

/**
 * Serialises balance-changing work for one creator. `FOR NO KEY UPDATE`, not
 * `FOR UPDATE`: inserting rows that reference the profile takes a KEY SHARE
 * lock on it, which `FOR UPDATE` would block (and deadlock against).
 */
export async function lockPointsAccount(tx: DbExecutor, creatorId: string) {
  const [row] = await tx
    .select({ id: creatorProfiles.id, status: creatorProfiles.profileStatus, userId: creatorProfiles.userId })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.id, creatorId))
    .for("no key update");
  return row ?? null;
}

export async function getPointsBalance(db: DbExecutor, creatorId: string): Promise<number> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${creatorPointsLedger.amount}), 0)` })
    .from(creatorPointsLedger)
    .where(eq(creatorPointsLedger.creatorId, creatorId));
  return Number(row?.balance ?? 0);
}

async function earnedMilestones(db: DbExecutor, creatorId: string): Promise<Set<PointsMilestone>> {
  const rows = await db
    .select({ milestone: creatorPointsLedger.milestone })
    .from(creatorPointsLedger)
    .where(and(eq(creatorPointsLedger.creatorId, creatorId), isNotNull(creatorPointsLedger.milestone)));
  return new Set(rows.map((r) => r.milestone!));
}

/**
 * Grants every milestone the creator now qualifies for and hasn't received.
 * Idempotent (one row per milestone, enforced by a unique index); never
 * removes anything. `tier` is the Creator Status to use — pass it when the
 * caller has just calculated it, otherwise the latest stored one is read.
 */
export async function grantDueMilestones(
  tx: DbExecutor,
  input: { creatorId: string; tier?: CreatorStatusTier },
): Promise<PointsMilestone[]> {
  const [facts] = await tx
    .select({ completedAt: creatorProfiles.completedAt, mobileVerifiedAt: users.mobileVerifiedAt })
    .from(creatorProfiles)
    .innerJoin(users, eq(users.id, creatorProfiles.userId))
    .where(eq(creatorProfiles.id, input.creatorId))
    .limit(1);
  if (!facts) return [];
  let tier = input.tier;
  if (!tier) {
    const [latest] = await tx
      .select({ tier: creatorStatusRuns.tier })
      .from(creatorStatusRuns)
      .where(eq(creatorStatusRuns.creatorId, input.creatorId))
      .orderBy(desc(creatorStatusRuns.computedAt), desc(creatorStatusRuns.createdAt))
      .limit(1);
    tier = latest?.tier ?? DEFAULT_CREATOR_STATUS;
  }
  const due = milestonesDue(
    { profileCompleted: facts.completedAt !== null, mobileVerified: facts.mobileVerifiedAt !== null, tier },
    await earnedMilestones(tx, input.creatorId),
  );
  const granted: PointsMilestone[] = [];
  for (const milestone of due) {
    const [row] = await tx
      .insert(creatorPointsLedger)
      .values({
        creatorId: input.creatorId,
        entryType: "earn",
        amount: MILESTONE_POINTS[milestone],
        milestone,
        rulesVersion: POINTS_RULES_VERSION,
      })
      .onConflictDoNothing()
      .returning({ id: creatorPointsLedger.id });
    if (!row) continue;
    granted.push(milestone);
    await recordAuditEvent(tx, {
      actorType: "system",
      eventType: "points.milestone_earned",
      entityType: "creator_profile",
      entityId: input.creatorId,
      metadata: { milestone, points: MILESTONE_POINTS[milestone], rules_version: POINTS_RULES_VERSION },
    });
  }
  return granted;
}

/** Holds points for a request. Callers have locked the account and checked the balance. */
export async function holdPoints(
  tx: DbExecutor,
  input: { creatorId: string; accessRequestId: string; points: number },
) {
  if (input.points <= 0) return;
  await tx.insert(creatorPointsLedger).values({
    creatorId: input.creatorId,
    entryType: "hold",
    amount: -input.points,
    accessRequestId: input.accessRequestId,
    rulesVersion: POINTS_RULES_VERSION,
  });
}

/** Returns a request's held points. Idempotent: a hold is released at most once. Returns the points released. */
export async function releasePoints(tx: DbExecutor, input: { creatorId: string; accessRequestId: string }) {
  const entries = await tx
    .select({ entryType: creatorPointsLedger.entryType, amount: creatorPointsLedger.amount })
    .from(creatorPointsLedger)
    .where(
      and(
        eq(creatorPointsLedger.creatorId, input.creatorId),
        eq(creatorPointsLedger.accessRequestId, input.accessRequestId),
      ),
    );
  const hold = entries.find((e) => e.entryType === "hold");
  if (!hold || entries.some((e) => e.entryType === "release")) return 0;
  const [row] = await tx
    .insert(creatorPointsLedger)
    .values({
      creatorId: input.creatorId,
      entryType: "release",
      amount: -hold.amount,
      accessRequestId: input.accessRequestId,
      rulesVersion: POINTS_RULES_VERSION,
    })
    .onConflictDoNothing()
    .returning({ amount: creatorPointsLedger.amount });
  return row?.amount ?? 0;
}

export interface PointsActivity {
  type: PointsEntryType;
  points: number;
  label: string;
  at: Date;
}

export interface PointsSummary {
  balance: number;
  /** Points held for requests still awaiting a decision (already taken from the balance). */
  held: number;
  activity: PointsActivity[];
}

const ACTIVITY_LABELS: Record<Exclude<PointsEntryType, "earn">, string> = {
  hold: "Held for an Access request",
  release: "Returned from an Access request",
};

/** What the creator sees: balance, points on hold and recent activity. Read-only. */
export async function getPointsSummary(db: DbExecutor, creatorId: string, limit = 50): Promise<PointsSummary> {
  const rows = await db
    .select()
    .from(creatorPointsLedger)
    .where(eq(creatorPointsLedger.creatorId, creatorId))
    .orderBy(asc(creatorPointsLedger.createdAt), asc(creatorPointsLedger.id));
  const balance = rows.reduce((s, r) => s + r.amount, 0);

  const released = new Set(rows.filter((r) => r.entryType === "release").map((r) => r.accessRequestId));
  const holds = rows.filter((r) => r.entryType === "hold");
  // Request history may have been erased; an unreleased hold without a pending request was spent.
  const statuses = holds.length
    ? await db
        .select({ id: accessRequests.id, status: accessRequests.status })
        .from(accessRequests)
        .where(
          inArray(
            accessRequests.id,
            holds.map((h) => h.accessRequestId!),
          ),
        )
    : [];
  const statusOf = new Map(statuses.map((s) => [s.id, s.status]));
  const isPending = (requestId: string | null) =>
    requestId !== null && !released.has(requestId) && statusOf.get(requestId) === "requested";
  const held = holds.filter((h) => isPending(h.accessRequestId)).reduce((s, h) => s - h.amount, 0);

  const labelFor = (r: (typeof rows)[number]) => {
    if (r.entryType === "earn") return MILESTONE_LABELS[r.milestone!];
    if (r.entryType === "release") return ACTIVITY_LABELS.release;
    if (isPending(r.accessRequestId)) return ACTIVITY_LABELS.hold;
    return released.has(r.accessRequestId) ? "Held for an Access request (returned)" : "Spent on an Access request";
  };
  const activity = rows
    .slice(-limit)
    .reverse()
    .map((r) => ({ type: r.entryType, points: r.amount, label: labelFor(r), at: r.createdAt }));
  return { balance, held, activity };
}
