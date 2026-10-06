"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { fieldErrorsFromZod, formError, readCheckbox, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { requireOpsAdmin } from "@/modules/identity";
import {
  IntegrationChangeError,
  approveChange,
  changeInputSchema,
  decisionNoteSchema,
  proposeChange,
  reasonSchema,
  rejectChange,
  runHealthChecks,
} from "@/modules/integrations";
import { JOB_HANDLERS, JOB_TYPES, retryJob, runDueJobs, runScheduleNow } from "@/modules/jobs";
import { recordAuditEvent } from "@/modules/audit";
import { PROVIDER_KINDS } from "@/providers/types";

/**
 * Thin /ops actions: authorise (ops_admin / super_admin), parse, call the
 * integrations or jobs module, redirect. Every change is audited by the
 * module. Secret values are never accepted — only env var names.
 */

const production = () => getServerEnv().APP_ENV === "production";
const idSchema = z.uuid();

function parseSettings(raw: string | undefined): Record<string, unknown> | null {
  const text = (raw ?? "").trim();
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `name=ENV_VAR` per line. */
function parseSecretRefs(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const [name, envVar] = line.split("=").map((s) => s.trim());
    if (name && envVar) out[name] = envVar;
  }
  return out;
}

function rawChange(form: FormData) {
  const action = readText(form, "action");
  const kind = readText(form, "kind");
  switch (action) {
    case "create_config":
      return {
        action,
        kind,
        key: readText(form, "key") ?? "",
        adapter: readText(form, "adapter") ?? "",
        mode: readText(form, "mode"),
        enabled: readCheckbox(form, "enabled"),
        settings: parseSettings(readText(form, "settings")),
        secretRefs: parseSecretRefs(readText(form, "secretRefs")),
      };
    case "update_config":
      return {
        action,
        configId: readText(form, "configId"),
        mode: readText(form, "mode"),
        enabled: readCheckbox(form, "enabled"),
        settings: parseSettings(readText(form, "settings")),
        secretRefs: parseSecretRefs(readText(form, "secretRefs")),
      };
    case "set_route":
      return {
        action,
        kind,
        primaryConfigId: readText(form, "primaryConfigId"),
        fallbackConfigId: readText(form, "fallbackConfigId") || null,
      };
    default:
      return { action, kind };
  }
}

export async function proposeChangeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireOpsAdmin();
  const values = { reason: readText(form, "reason") ?? "", settings: readText(form, "settings") ?? "" };
  const raw = rawChange(form);
  if ("settings" in raw && raw.settings === null) {
    return formError("Settings must be a JSON object.", {
      fieldErrors: { settings: ["Use a JSON object, e.g. {}"] },
      values,
    });
  }
  const change = changeInputSchema.safeParse(raw);
  const reason = reasonSchema.safeParse(readText(form, "reason"));
  if (!change.success || !reason.success) {
    return formError("Please check the highlighted fields.", {
      fieldErrors: {
        ...(change.success ? {} : fieldErrorsFromZod(change.error)),
        ...(reason.success ? {} : { reason: reason.error.issues.map((i) => i.message) }),
      },
      values,
    });
  }
  let target: string;
  try {
    const result = await proposeChange(
      { db: getDb(), production: production() },
      { actorId: user.userId, change: change.data, reason: reason.data },
    );
    const kind =
      PROVIDER_KINDS.find((k) => k === readText(form, "returnKind")) ??
      ("kind" in change.data ? change.data.kind : null);
    target = kind ? `/ops/providers/${kind}?notice=${result.status}` : `/ops/changes`;
  } catch (error) {
    if (error instanceof IntegrationChangeError) return formError(error.message, { values });
    logger.error("ops.propose_failed", describeError(error));
    return formError("We couldn't record this change. Please try again.", { values });
  }
  revalidatePath("/ops", "layout");
  redirect(target);
}

export async function decideChangeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireOpsAdmin();
  const requestId = idSchema.safeParse(readText(form, "requestId"));
  const note = decisionNoteSchema.safeParse(readText(form, "note"));
  const decision = readText(form, "decision");
  if (!requestId.success || !note.success || (decision !== "approve" && decision !== "reject")) {
    return formError("Please reload and try again.");
  }
  const deps = { db: getDb(), production: production() };
  let notice: string;
  try {
    if (decision === "approve") {
      await approveChange(deps, { actorId: user.userId, requestId: requestId.data, note: note.data });
      notice = "approved";
    } else {
      notice = (await rejectChange(deps, { actorId: user.userId, requestId: requestId.data, note: note.data })).status;
    }
  } catch (error) {
    if (error instanceof IntegrationChangeError) {
      revalidatePath("/ops", "layout");
      return formError(error.message);
    }
    logger.error("ops.decide_failed", describeError(error));
    return formError("We couldn't record this decision. Please try again.");
  }
  revalidatePath("/ops", "layout");
  redirect(`/ops/changes?notice=${notice}`);
}

export async function runHealthChecksAction(): Promise<void> {
  const user = await requireOpsAdmin();
  const db = getDb();
  const result = await runHealthChecks({ db, production: production() });
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: user.userId,
    eventType: "integrations.health_checked",
    entityType: "provider_config",
    metadata: { checked: result.checked, down: result.down },
  });
  revalidatePath("/ops", "layout");
  redirect("/ops?notice=checked");
}

export async function runJobNowAction(form: FormData): Promise<void> {
  const user = await requireOpsAdmin();
  const type = z.enum(JOB_TYPES).safeParse(readText(form, "type"));
  if (!type.success) redirect("/ops/jobs");
  const db = getDb();
  const id = await runScheduleNow(db, { type: type.data, actorId: user.userId });
  // Run just this job straight away rather than waiting for the next cron tick.
  if (id) await runDueJobs({ db, handlers: JOB_HANDLERS }, { limit: 1, onlyIds: [id] });
  revalidatePath("/ops/jobs");
  redirect("/ops/jobs?notice=ran");
}

export async function retryJobAction(form: FormData): Promise<void> {
  const user = await requireOpsAdmin();
  const jobId = idSchema.safeParse(readText(form, "jobId"));
  if (!jobId.success) redirect("/ops/jobs");
  const ok = await retryJob(getDb(), { jobId: jobId.data, actorId: user.userId });
  revalidatePath("/ops/jobs");
  redirect(`/ops/jobs?notice=${ok ? "retried" : "unchanged"}`);
}
