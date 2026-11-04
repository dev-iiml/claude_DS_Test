import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { isUniqueViolation } from "@/db/errors";
import { creatorProfiles, pointsTaskCompletions, pointsTasks } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { restrictedTextKinds } from "@/lib/restricted-text";
import { recordAuditEvent } from "@/modules/audit";

import { earnPoints } from "./ledger-service";
import { TASK_POINTS_MAX, TASK_POINTS_MIN, taskGuardrailViolations } from "./rules";
import type { PointsTaskCategory, PointsTaskStatus } from "./tasks-domain";

/**
 * Staff-defined Creator Points tasks (pts-0.2.0). Four eyes: one partnerships
 * admin proposes, a different one approves before creators see the task.
 * Points are fixed on the task (bounded) and earned once per creator when
 * staff mark it complete. Tasks never reward consents, data sharing or credit
 * (guardrail check here, the approver, and the earn-trigger test).
 */
export class TaskError extends Error {
  constructor(
    readonly code: "invalid" | "not_found" | "wrong_state" | "four_eyes" | "creator_not_found" | "already_completed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TaskError";
  }
}

export interface TaskInput {
  title: string;
  description: string;
  category: PointsTaskCategory;
  points: number;
}

export function validateTask(input: TaskInput): string | null {
  if (input.title.trim().length < 4 || input.title.trim().length > 80)
    return "Keep the title between 4 and 80 characters.";
  if (input.description.trim().length < 10 || input.description.trim().length > 400)
    return "Describe the task in 10–400 characters.";
  if (!Number.isInteger(input.points) || input.points < TASK_POINTS_MIN || input.points > TASK_POINTS_MAX)
    return `Points must be between ${TASK_POINTS_MIN} and ${TASK_POINTS_MAX}.`;
  const blocked = taskGuardrailViolations(`${input.title} ${input.description}`);
  if (blocked.length)
    return `Tasks can't reward consents, data sharing or anything credit-related (found: ${blocked.join(", ")}).`;
  if (restrictedTextKinds(`${input.title} ${input.description}`).length)
    return "Remove personal identifiers (numbers, e-mail addresses, phone numbers) from the task.";
  return null;
}

export async function proposeTask(db: DbExecutor, input: TaskInput & { staffUserId: string; now?: Date }) {
  const error = validateTask(input);
  if (error) throw new TaskError("invalid", error);
  const now = input.now ?? new Date();
  const [task] = await db
    .insert(pointsTasks)
    .values({
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      points: input.points,
      status: "proposed",
      proposedBy: input.staffUserId,
      proposedAt: now,
    })
    .returning();
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.staffUserId,
    eventType: "points_task.proposed",
    entityType: "points_task",
    entityId: task!.id,
    metadata: { category: input.category, points: input.points },
  });
  return task!;
}

/** A different admin approves (task goes live) or rejects a proposed task. */
export async function decideTask(
  db: Database,
  input: { staffUserId: string; taskId: string; decision: "approve" | "reject"; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(pointsTasks).where(eq(pointsTasks.id, input.taskId)).for("update");
    if (!task) throw new TaskError("not_found");
    if (task.status !== "proposed") throw new TaskError("wrong_state", "This task has already been decided.");
    if (task.proposedBy === input.staffUserId)
      throw new TaskError("four_eyes", "Another partnerships admin has to approve your task.");
    if (input.decision === "approve") {
      const error = validateTask(task);
      if (error) throw new TaskError("invalid", error);
    }
    await tx
      .update(pointsTasks)
      .set({
        status: input.decision === "approve" ? "active" : "rejected",
        decidedBy: input.staffUserId,
        decidedAt: now,
      })
      .where(eq(pointsTasks.id, task.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: input.decision === "approve" ? "points_task.approved" : "points_task.rejected",
      entityType: "points_task",
      entityId: task.id,
    });
  });
}

export async function retireTask(db: DbExecutor, input: { staffUserId: string; taskId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const rows = await db
    .update(pointsTasks)
    .set({ status: "retired", retiredAt: now })
    .where(and(eq(pointsTasks.id, input.taskId), eq(pointsTasks.status, "active")))
    .returning({ id: pointsTasks.id });
  if (!rows.length) throw new TaskError("wrong_state", "Only live tasks can be retired.");
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.staffUserId,
    eventType: "points_task.retired",
    entityType: "points_task",
    entityId: input.taskId,
  });
}

/**
 * Marks a live task complete for a creator (found by their handle) and grants
 * the task's points once. The note says how completion was checked — no
 * personal identifiers.
 */
export async function completeTask(
  db: Database,
  input: { staffUserId: string; taskId: string; creatorHandle: string; note: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  const note = input.note?.trim() || null;
  if (note && (note.length > 280 || restrictedTextKinds(note).length))
    throw new TaskError("invalid", "Keep the note short and free of personal identifiers.");
  const handle = input.creatorHandle.trim().replace(/^@/, "").toLowerCase();
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(pointsTasks).where(eq(pointsTasks.id, input.taskId));
    if (!task) throw new TaskError("not_found");
    if (task.status !== "active") throw new TaskError("wrong_state", "Only live tasks can be completed.");
    const [creator] = await tx
      .select({ id: creatorProfiles.id, userId: creatorProfiles.userId })
      .from(creatorProfiles)
      .where(
        and(
          sql`lower(${creatorProfiles.primaryCreatorHandle}) = ${handle}`,
          eq(creatorProfiles.profileStatus, "completed"),
        ),
      )
      .limit(1);
    if (!creator) throw new TaskError("creator_not_found", "No active member has that handle.");
    if (creator.userId === input.staffUserId)
      throw new TaskError("four_eyes", "You can't complete a task for yourself.");
    try {
      await tx.insert(pointsTaskCompletions).values({
        taskId: task.id,
        creatorId: creator.id,
        markedBy: input.staffUserId,
        note,
        completedAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error, "points_task_completions_key"))
        throw new TaskError("already_completed", "This creator has already completed the task.");
      throw error;
    }
    await earnPoints(tx, { creatorId: creator.id, rule: "task_completed", ref: task.id, points: task.points, now });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffUserId,
      eventType: "points_task.completed",
      entityType: "points_task",
      entityId: task.id,
      metadata: { points: task.points },
    });
    return { creatorId: creator.id };
  });
}

export interface StaffTaskRow {
  id: string;
  title: string;
  description: string;
  category: PointsTaskCategory;
  points: number;
  status: PointsTaskStatus;
  proposedBy: string | null;
  proposedAt: Date;
  decidedAt: Date | null;
  completions: number;
}

export async function listTasksForStaff(db: DbExecutor): Promise<StaffTaskRow[]> {
  const rows = await db
    .select({
      t: pointsTasks,
      completions: sql<number>`(select count(*)::int from ${pointsTaskCompletions} c where c.task_id = ${pointsTasks.id})`,
    })
    .from(pointsTasks)
    .orderBy(
      asc(sql`case ${pointsTasks.status} when 'proposed' then 0 when 'active' then 1 else 2 end`),
      desc(pointsTasks.proposedAt),
    );
  return rows.map(({ t, completions }) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    points: t.points,
    status: t.status,
    proposedBy: t.proposedBy,
    proposedAt: t.proposedAt,
    decidedAt: t.decidedAt,
    completions: Number(completions),
  }));
}

export interface CreatorTaskView {
  id: string;
  title: string;
  description: string;
  category: PointsTaskCategory;
  points: number;
  completedAt: Date | null;
}

/** Live tasks, plus any the creator completed before they were retired. */
export async function listTasksForCreator(db: DbExecutor, creatorId: string): Promise<CreatorTaskView[]> {
  const done = await db
    .select({ taskId: pointsTaskCompletions.taskId, completedAt: pointsTaskCompletions.completedAt })
    .from(pointsTaskCompletions)
    .where(eq(pointsTaskCompletions.creatorId, creatorId));
  const doneAt = new Map(done.map((d) => [d.taskId, d.completedAt]));
  const tasks = await db
    .select()
    .from(pointsTasks)
    .where(
      done.length
        ? sql`${pointsTasks.status} = 'active' or ${inArray(pointsTasks.id, [...doneAt.keys()])}`
        : eq(pointsTasks.status, "active"),
    )
    .orderBy(asc(pointsTasks.title));
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    points: t.points,
    completedAt: doneAt.get(t.id) ?? null,
  }));
}
