import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { POINTS_TASK_CATEGORIES, POINTS_TASK_STATUSES } from "@/modules/rewards/tasks-domain";
import { TASK_POINTS_MAX, TASK_POINTS_MIN } from "@/modules/rewards/rules";

import { createdAt, sqlInList, updatedAt } from "./_shared";
import { creatorProfiles } from "./creator-profile";
import { users } from "./identity";

/**
 * Staff-defined Creator Points tasks (pts-0.2.0). A partnerships admin drafts a
 * task; a DIFFERENT admin approves it before creators see it (four eyes). Points
 * are fixed on the task within bounds and earned once per creator. Tasks never
 * reward consents, data sharing or anything credit-related (guardrail check +
 * the approver). Creator-professional domain; no financial data.
 */
export const pointsTasks = pgTable(
  "points_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category", { enum: POINTS_TASK_CATEGORIES }).notNull(),
    points: integer("points").notNull(),
    status: text("status", { enum: POINTS_TASK_STATUSES }).notNull().default("proposed"),
    proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "set null" }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("points_tasks_status_idx").on(t.status),
    check("points_tasks_status_valid", sql`${t.status} in (${sqlInList(POINTS_TASK_STATUSES)})`),
    check("points_tasks_category_valid", sql`${t.category} in (${sqlInList(POINTS_TASK_CATEGORIES)})`),
    check(
      "points_tasks_points_range",
      sql`${t.points} between ${sql.raw(String(TASK_POINTS_MIN))} and ${sql.raw(String(TASK_POINTS_MAX))}`,
    ),
    check("points_tasks_title_length", sql`char_length(${t.title}) between 4 and 80`),
    check("points_tasks_description_length", sql`char_length(${t.description}) between 10 and 400`),
    check("points_tasks_four_eyes", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.proposedBy}`),
  ],
).enableRLS();

/** A creator completed a task (marked by partnerships staff). One per creator per task. */
export const pointsTaskCompletions = pgTable(
  "points_task_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => pointsTasks.id, { onDelete: "restrict" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    markedBy: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    /** Short staff note on how completion was checked. No personal or financial data. */
    note: text("note"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("points_task_completions_key").on(t.taskId, t.creatorId),
    index("points_task_completions_creator_idx").on(t.creatorId),
    check("points_task_completions_note_length", sql`${t.note} is null or char_length(${t.note}) <= 280`),
  ],
).enableRLS();
