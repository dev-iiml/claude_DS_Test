"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import { formError, readText, type FormState } from "@/lib/forms";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { POINTS_TASK_CATEGORIES } from "@/modules/rewards/tasks-domain";
import { TaskError, completeTask, decideTask, proposeTask, retireTask } from "@/modules/rewards/tasks-service";

const idSchema = z.uuid();
const taskSchema = z.object({
  title: z.string().trim().min(4, "Keep the title between 4 and 80 characters.").max(80),
  description: z.string().trim().min(10, "Describe the task in 10–400 characters.").max(400),
  category: z.enum(POINTS_TASK_CATEGORIES, "Choose a category."),
  points: z.coerce.number().int("Whole points only."),
});

function failure(error: unknown, fallback: string, values?: FormState["values"]): FormState {
  if (error instanceof TaskError) return formError(error.message !== error.code ? error.message : fallback, { values });
  logger.error("points_task.action_failed", describeError(error));
  return formError(fallback, { values });
}

export async function proposeTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const values = {
    title: readText(form, "title") ?? "",
    description: readText(form, "description") ?? "",
    category: readText(form, "category") ?? "",
    points: readText(form, "points") ?? "",
  };
  const parsed = taskSchema.safeParse(values);
  if (!parsed.success) return formError(parsed.error.issues[0]?.message ?? "Check the task.", { values });
  let id: string;
  try {
    id = (await proposeTask(getDb(), { ...parsed.data, staffUserId: staff.userId })).id;
  } catch (error) {
    return failure(error, "We couldn't save the task.", values);
  }
  redirect(`/partnerships/tasks/${id}?notice=proposed`);
}

export async function decideTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const taskId = idSchema.safeParse(readText(form, "taskId"));
  const decision = readText(form, "decision");
  if (!taskId.success || (decision !== "approve" && decision !== "reject"))
    return formError("Please reload and try again.");
  try {
    await decideTask(getDb(), { staffUserId: staff.userId, taskId: taskId.data, decision });
  } catch (error) {
    return failure(error, "We couldn't record the decision.");
  }
  redirect(`/partnerships/tasks/${taskId.data}?notice=${decision === "approve" ? "approved" : "rejected"}`);
}

export async function retireTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const taskId = idSchema.safeParse(readText(form, "taskId"));
  if (!taskId.success) return formError("Please reload and try again.");
  try {
    await retireTask(getDb(), { staffUserId: staff.userId, taskId: taskId.data });
  } catch (error) {
    return failure(error, "We couldn't retire the task.");
  }
  redirect(`/partnerships/tasks/${taskId.data}?notice=retired`);
}

export async function completeTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requirePartnershipsAdmin();
  const taskId = idSchema.safeParse(readText(form, "taskId"));
  const handle = readText(form, "handle") ?? "";
  const note = readText(form, "note") ?? null;
  if (!taskId.success) return formError("Please reload and try again.");
  if (handle.trim().length < 2)
    return formError("Enter the creator's handle.", { values: { handle, note: note ?? "" } });
  try {
    await completeTask(getDb(), { staffUserId: staff.userId, taskId: taskId.data, creatorHandle: handle, note });
  } catch (error) {
    return failure(error, "We couldn't mark the task complete.", { handle, note: note ?? "" });
  }
  redirect(`/partnerships/tasks/${taskId.data}?notice=completed`);
}
