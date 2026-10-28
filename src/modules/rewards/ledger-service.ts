import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { accessOpportunities, accessRequests, creatorPointsLedger, creatorProfiles, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import { EARN_RULES, POINTS_RULES_VERSION, earnKeyFor, type EarnRule } from "./rules";

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

/** Grants a rule's points once per creator (idempotent). Returns whether this call granted them. */
export async function earnPoints(
  tx: DbExecutor,
  input: { creatorId: string; rule: EarnRule; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const rows = await tx
    .insert(creatorPointsLedger)
    .values({
      creatorId: input.creatorId,
      entryType: "earn",
      amount: EARN_RULES[input.rule].points,
      rule: input.rule,
      rulesVersion: POINTS_RULES_VERSION,
      earnKey: earnKeyFor(input.rule),
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
    metadata: { rule: input.rule, points: EARN_RULES[input.rule].points, rules_version: POINTS_RULES_VERSION },
  });
  return true;
}

/**
 * Grants membership milestones the creator has reached (welcome, verified
 * mobile). Idempotent — safe to call from any hook or as a backfill.
 */
export async function syncMilestonePoints(db: DbExecutor, input: { userId: string; now?: Date }) {
  const [row] = await db
    .select({
      creatorId: creatorProfiles.id,
      status: creatorProfiles.profileStatus,
      mobileVerifiedAt: users.mobileVerifiedAt,
    })
    .from(creatorProfiles)
    .innerJoin(users, eq(users.id, creatorProfiles.userId))
    .where(eq(creatorProfiles.userId, input.userId))
    .limit(1);
  if (!row || row.status !== "completed") return { granted: 0 };
  const rules: EarnRule[] = ["welcome", ...(row.mobileVerifiedAt ? (["mobile_verified"] as const) : [])];
  const existing = await db
    .select({ rule: creatorPointsLedger.rule })
    .from(creatorPointsLedger)
    .where(and(eq(creatorPointsLedger.creatorId, row.creatorId), inArray(creatorPointsLedger.rule, rules)));
  let granted = 0;
  for (const rule of rules.filter((r) => !existing.some((e) => e.rule === r))) {
    if (await earnPoints(db, { creatorId: row.creatorId, rule, now: input.now })) granted += 1;
  }
  return { granted };
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
  type: "earned" | "held" | "spent" | "returned";
  amount: number;
  label: string;
  occurredAt: Date;
}

export interface PointsSummary {
  balance: number;
  onHold: number;
  history: PointsEntryView[];
}

/** Balance, points on hold for pending requests, and the creator-facing history. */
export async function getPointsSummary(db: DbExecutor, creatorId: string, limit = 50): Promise<PointsSummary> {
  const rows = await db
    .select({
      id: creatorPointsLedger.id,
      type: creatorPointsLedger.entryType,
      amount: creatorPointsLedger.amount,
      rule: creatorPointsLedger.rule,
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
  const history = rows.slice(0, limit).map((r): PointsEntryView => {
    const title = r.title ?? "an opportunity";
    if (r.type === "earn")
      return {
        id: r.id,
        type: "earned",
        amount: r.amount,
        label: r.rule && r.rule in EARN_RULES ? EARN_RULES[r.rule as EarnRule].label : "Points earned",
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
