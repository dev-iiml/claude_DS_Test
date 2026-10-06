import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { creatorProfiles, creditApplications } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";

import { OPEN_APPLICATION_STATUSES } from "./domain";

/** Shared by the eligibility services (application and bank data). */

export class FinancialEligibilityError extends Error {
  constructor(
    readonly code:
      | "profile_inactive"
      | "consent_required"
      | "not_found"
      | "wrong_step"
      | "bureau_limit"
      | "pan_mismatch"
      | "provider_error"
      | "provider_changed"
      | "number_limit"
      | "duplicate_number",
    message?: string,
    /** The check concerned, when the caller can resume it. */
    readonly applicationId?: string,
  ) {
    super(message ?? code);
    this.name = "FinancialEligibilityError";
  }
}

export interface FinDeps {
  db: Database;
  now?: Date;
}

export type Application = typeof creditApplications.$inferSelect;
export const isOpen = (a: Application) => (OPEN_APPLICATION_STATUSES as readonly string[]).includes(a.status);

export async function completedProfile(db: DbExecutor, userId: string) {
  const [p] = await db
    .select({ id: creatorProfiles.id, status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);
  if (!p || p.status !== "completed") throw new FinancialEligibilityError("profile_inactive");
  return p.id;
}

export async function ownOpenApplication(db: DbExecutor, userId: string, applicationId: string, lock = false) {
  const q = db
    .select()
    .from(creditApplications)
    .where(and(eq(creditApplications.id, applicationId), eq(creditApplications.userId, userId)))
    .limit(1);
  const [app] = lock ? await q.for("update") : await q;
  if (!app) throw new FinancialEligibilityError("not_found");
  if (!isOpen(app)) throw new FinancialEligibilityError("wrong_step", "This check is closed.");
  return app;
}

export async function requireConsent(db: DbExecutor, userId: string, now: Date) {
  if (!(await hasValidConsent(db, userId, CONSENT_KEYS.financialEligibility, now))) {
    throw new FinancialEligibilityError("consent_required");
  }
}

export async function audit(
  db: DbExecutor,
  userId: string,
  applicationId: string,
  eventType: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: userId,
    eventType,
    entityType: "credit_application",
    entityId: applicationId,
    metadata,
  });
}

/**
 * A change after the creator confirmed sends the check back to Review
 * (user decision): its earlier Financial Capacity and recommendation stay as
 * history; confirming again computes new ones from the changed inputs.
 */
export async function reopenIfConfirmed(tx: DbExecutor, app: Application, userId: string): Promise<Application> {
  if (app.status !== "inputs_ready") return app;
  const [updated] = await tx
    .update(creditApplications)
    .set({ status: "draft", inputsReadyAt: null, financialRunId: null })
    .where(eq(creditApplications.id, app.id))
    .returning();
  await audit(tx, userId, app.id, "financial_eligibility.reopened");
  return updated!;
}
