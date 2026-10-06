import "server-only";

import { notFound, redirect } from "next/navigation";

import { getDb } from "@/db";
import { getApplication } from "@/modules/financial-eligibility/application-service";

import { requireMember } from "@/app/_lib/member";

import { canOpen, stepPath, type EligibilityStep } from "./steps";

/** Authorises a member and loads their own application for a step page. */
export async function loadApplicationStep(id: string, step: EligibilityStep) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { user } = await requireMember();
  const app = await getApplication(getDb(), { userId: user.userId, applicationId: id });
  if (!app) notFound();
  if (step !== "summary" && app.status !== "draft" && app.status !== "inputs_ready") redirect(`/eligibility/${app.id}`);
  if (!canOpen(app, step)) redirect(stepPath(app));
  return { user, app };
}
