"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { readText } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { PassportError } from "@/modules/public-passport/errors";
import { decideTakedown, handleReport, takePassportOffline } from "@/modules/public-passport/moderation-service";

const idSchema = z.uuid();

async function run(
  passportId: string | undefined,
  fn: (staffId: string, passportId: string) => Promise<unknown>,
  ok: string,
) {
  const staff = await requirePartnershipsAdmin();
  const id = idSchema.safeParse(passportId);
  if (!id.success) redirect("/partnerships/passports");
  let notice = ok;
  try {
    await fn(staff.userId, id.data);
  } catch (error) {
    if (error instanceof PassportError) notice = `error_${error.code}`;
    else {
      logger.error("passport_desk.action_failed", describeError(error));
      notice = "error_failed";
    }
  }
  revalidatePath(`/partnerships/passports/${id.data}`);
  redirect(`/partnerships/passports/${id.data}?notice=${notice}`);
}

export async function takeOfflineAction(form: FormData) {
  await run(
    readText(form, "passportId"),
    (staffId, passportId) =>
      takePassportOffline(getDb(), { staffId, passportId, reason: readText(form, "reason") ?? "" }),
    "offline",
  );
}

const STEPS = ["propose_permanent", "approve_permanent", "lift"] as const;

export async function decideTakedownAction(form: FormData) {
  const step = STEPS.find((s) => s === readText(form, "step"));
  const takedownId = idSchema.safeParse(readText(form, "takedownId"));
  await run(
    readText(form, "passportId"),
    async (staffId) => {
      if (!step || !takedownId.success) throw new PassportError("invalid");
      await decideTakedown(getDb(), { staffId, takedownId: takedownId.data, step });
    },
    step ?? "done",
  );
}

export async function handleReportAction(form: FormData) {
  const outcome = readText(form, "outcome") === "actioned" ? "actioned" : "dismissed";
  const reportId = idSchema.safeParse(readText(form, "reportId"));
  await run(
    readText(form, "passportId"),
    async (staffId) => {
      if (!reportId.success) throw new PassportError("invalid");
      await handleReport(getDb(), { staffId, reportId: reportId.data, outcome });
    },
    `report_${outcome}`,
  );
}
