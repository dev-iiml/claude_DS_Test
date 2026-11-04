import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import {
  accessOpportunities,
  accessRequests,
  creatorPointsLedger,
  creatorProfiles,
  pointsTasks,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import { profileDetailsComplete } from "@/modules/creator-profile/profile-details";

import {
  EARN_RULES,
  POINTS_RULES_VERSION,
  TASK_POINTS_MAX,
  TASK_POINTS_MIN,
  earnKeyFor,
  membershipYears,
  reverseKeyFor,
  type EarnRule,
} from "./rules";

/**
 * Creator Points ledger (Stage 14). Append-only (DB-enforced); balance is the
 * sum of entries. Every balance-reducing write happens with the creator's
 * profile row locked (`lockPointsAccount`), so two requests can't spend the
 * same points.
 */
export class PointsError extends Error {
  constructor(
    readonly code: "insufficient" | "not_found",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PointsError";
  }
}

/**
 * Serialises balance changes for one creator. Call inside the transaction that holds points.
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: it must not conflict with the KEY SHARE locks that
 * ledger inserts (and every other FK insert) take on the profile row, or a release elsewhere
 * would deadlock against a request.
 */
export async function lockPointsAccount(tx: DbExecutor, creatorId: string) {
  const [row] = await tx
    .select({ id: creatorProfiles.id, status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.id, creatorId))
    .for("no key update");
  if (!row) throw new PointsError("not_found");
  return row;
}

export async function pointsBalance(db: DbExecutor, creatorId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${creatorPointsLedger.amount})` })
    .from(creatorPointsLedger)
    .where(eq(creatorPointsLedger.creatorId, creatorId));
  return Number(row?.total ?? 0);
}

/**
 * Grants a rule's points once per idempotency key (idempotent). Repeatable
 * rules take a reference (`ref`): the membership year, request or task. Staff
 * tasks pass their own points (bounded). Returns whether this call granted them.
 */
export async function earnPoints(
  tx: DbExecutor,
  input: {
    creatorId: string;
    rule: EarnRule;
    ref?: string | number;
    /** Staff tasks only: the task's points (TASK_POINTS_MIN–MAX). */
    points?: number;
    /** access_completed: the request (for the history label). */
    requestId?: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const fixed = EARN_RULES[input.rule].points;
  const points = fixed ?? input.points;
  if (points === undefined || points === null) throw new PointsError("not_found", `${input.rule} needs points`);
  if (fixed === null && (points < TASK_POINTS_MIN || points > TASK_POINTS_MAX)) {
    throw new PointsError("not_found", "Task points out of range");
  }
  const earnKey = earnKeyFor(input.rule, input.ref);
  const rows = await tx
    .insert(creatorPointsLedger)
    .values({
      creatorId: input.creatorId,
      entryType: "earn",
      amount: points,
      rule: input.rule,
      rulesVersion: POINTS_RULES_VERSION,
      earnKey,
      requestId: input.requestId ?? null,
      occurredAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: creatorPointsLedger.id });
  if (!rows.length) return false;
  await recordAuditEvent(tx, {
    actorType: "system",
    eventType: "points.earned",
    entityType: "creator_profile",
    entityId: input.creatorId,
    metadata: { rule: input.rule, points, rules_version: POINTS_RULES_VERSION },
  });
  return true;
}

/**
 * Reverses an earned grant (e.g. a brand-work verification reversed after a
 * four-eyes review). Idempotent per earn entry. If the balance would go
 * negative, pending Access requests are cancelled first (their held points
 * return), then the reversal is floored at what's available. The caller holds `lockPointsAccount`.
 */
export async function reversePoints(
  tx: DbExecutor,
  input: { creatorId: string; earnKey: string; reason: string; now?: Date },
): Promise<{ reversed: number; flooredBy: number }> {
  const now = input.now ?? new Date();
  const [earn] = await tx
    .select()
    .from(creatorPointsLedger)
    .where(
      and(
        eq(creatorPointsLedger.creatorId, input.creatorId),
        eq(creatorPointsLedger.earnKey, input.earnKey),
        eq(creatorPointsLedger.entryType, "earn"),
      ),
    )
    .limit(1);
  if (!earn) return { reversed: 0, flooredBy: 0 };
  const reverseKey = reverseKeyFor(input.earnKey);
  const [already] = await tx
    .select({ id: creatorPointsLedger.id })
    .from(creatorPointsLedger)
    .where(and(eq(creatorPointsLedger.creatorId, input.creatorId), eq(creatorPointsLedger.earnKey, reverseKey)))
    .limit(1);
  if (already) return { reversed: 0, flooredBy: 0 };

  let balance = await pointsBalance(tx, input.creatorId);
  if (balance < earn.amount) {
    // Cancel pending requests first (their held points come back) before anything is floored.
    const pending = await tx
      .select({ id: accessRequests.id })
      .from(accessRequests)
      .where(and(eq(accessRequests.creatorId, input.creatorId), eq(accessRequests.status, "requested")))
      .for("update");
    for (const r of pending) {
      await tx
        .update(accessRequests)
        .set({ status: "cancelled", closedAt: now })
        .where(and(eq(accessRequests.id, r.id), eq(accessRequests.status, "requested")));
      await releasePoints(tx, { creatorId: input.creatorId, requestId: r.id, now });
    }
    balance = await pointsBalance(tx, input.creatorId);
  }
  const amount = Math.min(earn.amount, Math.max(0, balance));
  const flooredBy = earn.amount - amount;
  if (amount > 0) {
    await tx.insert(creatorPointsLedger).values({
      creatorId: input.creatorId,
      entryType: "reverse",
      amount: -amount,
      rule: earn.rule!,
      rulesVersion: POINTS_RULES_VERSION,
      earnKey: reverseKey,
      occurredAt: now,
    });
  }
  await recordAuditEvent(tx, {
    actorType: "system",
    eventType: "points.reversed",
    entityType: "creator_profile",
    entityId: input.creatorId,
    metadata: { rule: earn.rule ?? "unknown", points: amount, floored_by: flooredBy, reason: input.reason },
  });
  return { reversed: amount, flooredBy };
}

/**
 * Grants membership milestones the creator has reached (welcome, verified
 * mobile, profile details complete, membership anniversaries). Idempotent —
 * safe to call from any hook, the daily job or as a backfill.
 *
 * "Profile details complete" counts only the details the creator types in —
 * never the connected-account or consent items, so it can't reward a consent.
 */
export async function syncMilestonePoints(db: DbExecutor, input: { userId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const [row] = await db
    .select({
      creatorId: creatorProfiles.id,
      status: creatorProfiles.profileStatus,
      completedAt: creatorProfiles.completedAt,
      mobileVerifiedAt: users.mobileVerifiedAt,
    })
    .from(creatorProfiles)
    .innerJoin(users, eq(users.id, creatorProfiles.userId))
    .where(eq(creatorProfiles.userId, input.userId))
    .limit(1);
  if (!row || row.status !== "completed") return { granted: 0 };
  const details = await profileDetailsComplete(db, input.userId);
  const grants: { rule: EarnRule; ref?: number }[] = [
    { rule: "welcome" },
    ...(row.mobileVerifiedAt ? [{ rule: "mobile_verified" as const }] : []),
    ...(details ? [{ rule: "passport_complete" as const }] : []),
  ];
  const years = row.completedAt ? membershipYears(row.completedAt, now) : 0;
  for (let y = 1; y <= years; y++) grants.push({ rule: "membership_anniversary", ref: y });
  const existing = new Set(
    (
      await db
        .select({ key: creatorPointsLedger.earnKey })
        .from(creatorPointsLedger)
        .where(and(eq(creatorPointsLedger.creatorId, row.creatorId), eq(creatorPointsLedger.entryType, "earn")))
    ).map((e) => e.key),
  );
  let granted = 0;
  for (const g of grants.filter((g) => !existing.has(earnKeyFor(g.rule, g.ref)))) {
    if (await earnPoints(db, { creatorId: row.creatorId, rule: g.rule, ref: g.ref, now })) granted += 1;
  }
  return { granted };
}

/** Daily sweep: membership anniversaries, and any milestone a hook missed (e.g. a mobile verified later). */
export async function grantMembershipMilestones(deps: { db: DbExecutor; now?: Date }) {
  const now = deps.now ?? new Date();
  const members = await deps.db
    .select({ userId: creatorProfiles.userId })
    .from(creatorProfiles)
    .where(and(eq(creatorProfiles.profileStatus, "completed"), lte(creatorProfiles.completedAt, now)));
  let granted = 0;
  for (const m of members) granted += (await syncMilestonePoints(deps.db, { userId: m.userId, now })).granted;
  return { members: members.length, granted };
}

/** Holds points for a pending request. The caller holds `lockPointsAccount`. */
export async function holdPoints(
  tx: DbExecutor,
  input: { creatorId: string; requestId: string; amount: number; now: Date },
) {
  if (input.amount <= 0) return;
  if ((await pointsBalance(tx, input.creatorId)) < input.amount) throw new PointsError("insufficient");
  await tx.insert(creatorPointsLedger).values({
    creatorId: input.creatorId,
    entryType: "hold",
    amount: -input.amount,
    requestId: input.requestId,
    occurredAt: input.now,
  });
}

/** Returns a request's held points (once). No-op when nothing was held. */
export async function releasePoints(tx: DbExecutor, input: { creatorId: string; requestId: string; now: Date }) {
  const entries = await tx
    .select({ type: creatorPointsLedger.entryType, amount: creatorPointsLedger.amount })
    .from(creatorPointsLedger)
    .where(and(eq(creatorPointsLedger.creatorId, input.creatorId), eq(creatorPointsLedger.requestId, input.requestId)));
  const hold = entries.find((e) => e.type === "hold");
  if (!hold || entries.some((e) => e.type === "release")) return 0;
  await tx.insert(creatorPointsLedger).values({
    creatorId: input.creatorId,
    entryType: "release",
    amount: -hold.amount,
    requestId: input.requestId,
    occurredAt: input.now,
  });
  return -hold.amount;
}

export interface PointsEntryView {
  id: string;
  type: "earned" | "held" | "spent" | "returned" | "reversed";
  amount: number;
  label: string;
  occurredAt: Date;
}

export interface PointsSummary {
  balance: number;
  onHold: number;
  history: PointsEntryView[];
}

const ruleLabel = (rule: string | null) =>
  rule && rule in EARN_RULES ? EARN_RULES[rule as EarnRule].label : "Points earned";

/** Balance, points on hold for pending requests, and the creator-facing history. */
export async function getPointsSummary(db: DbExecutor, creatorId: string, limit = 50): Promise<PointsSummary> {
  const rows = await db
    .select({
      id: creatorPointsLedger.id,
      type: creatorPointsLedger.entryType,
      amount: creatorPointsLedger.amount,
      rule: creatorPointsLedger.rule,
      earnKey: creatorPointsLedger.earnKey,
      requestId: creatorPointsLedger.requestId,
      occurredAt: creatorPointsLedger.occurredAt,
      requestStatus: accessRequests.status,
      title: accessOpportunities.title,
    })
    .from(creatorPointsLedger)
    .leftJoin(accessRequests, eq(accessRequests.id, creatorPointsLedger.requestId))
    .leftJoin(accessOpportunities, eq(accessOpportunities.id, accessRequests.opportunityId))
    .where(eq(creatorPointsLedger.creatorId, creatorId))
    .orderBy(desc(creatorPointsLedger.occurredAt), desc(creatorPointsLedger.createdAt));
  const released = new Set(rows.filter((r) => r.type === "release").map((r) => r.requestId));
  // A hold is open while its request is pending; it stands as the spend once the request is approved —
  // or, when the request history was erased, if it was never released.
  const holdState = (r: (typeof rows)[number]) =>
    released.has(r.requestId) ? "returned" : r.requestStatus === "requested" ? "held" : "spent";
  const balance = rows.reduce((s, r) => s + r.amount, 0);
  const onHold = rows.filter((r) => r.type === "hold" && holdState(r) === "held").reduce((s, r) => s - r.amount, 0);
  const page = rows.slice(0, limit);
  const refOf = (key: string | null) => key?.split(":").slice(1).join(":") ?? "";
  const titles = await taskTitlesFor(
    db,
    page.filter((r) => r.rule === "task_completed").map((r) => refOf(r.earnKey?.replace(/^reverse:/, "") ?? null)),
  );
  const earnLabel = (r: (typeof rows)[number], key: string | null) => {
    if (r.rule === "membership_anniversary") return `Membership anniversary (year ${refOf(key)})`;
    if (r.rule === "access_completed") return r.title ? `Took part in ${r.title}` : ruleLabel(r.rule);
    if (r.rule === "task_completed") {
      const title = titles.get(refOf(key));
      return title ? `Task: ${title}` : ruleLabel(r.rule);
    }
    return ruleLabel(r.rule);
  };
  const history = page.map((r): PointsEntryView => {
    const title = r.title ?? "an opportunity";
    if (r.type === "earn")
      return { id: r.id, type: "earned", amount: r.amount, label: earnLabel(r, r.earnKey), occurredAt: r.occurredAt };
    if (r.type === "reverse")
      return {
        id: r.id,
        type: "reversed",
        amount: r.amount,
        label: `Reversed: ${earnLabel(r, r.earnKey?.replace(/^reverse:/, "") ?? null)}`,
        occurredAt: r.occurredAt,
      };
    if (r.type === "release")
      return {
        id: r.id,
        type: "returned",
        amount: r.amount,
        label: `Returned from ${title}`,
        occurredAt: r.occurredAt,
      };
    const spent = holdState(r) === "spent";
    return {
      id: r.id,
      type: spent ? "spent" : "held",
      amount: r.amount,
      label: spent ? `Spent on ${title}` : `Held for ${title}`,
      occurredAt: r.occurredAt,
    };
  });
  return { balance, onHold, history };
}

async function taskTitlesFor(db: DbExecutor, ids: string[]): Promise<Map<string, string>> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!valid.length) return new Map();
  const rows = await db
    .select({ id: pointsTasks.id, title: pointsTasks.title })
    .from(pointsTasks)
    .where(inArray(pointsTasks.id, valid));
  return new Map(rows.map((r) => [r.id, r.title]));
}
