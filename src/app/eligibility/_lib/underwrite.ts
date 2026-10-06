import "server-only";

import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import { proposeIfShared } from "@/modules/lending";
import { runUnderwriting } from "@/modules/underwriting/underwriting-service";

import { lendingDeps } from "@/app/_lib/lending";

/**
 * Prepares (or reuses) the CreatorCo recommendation once a check is
 * confirmed, then — if the creator shares with a partner lender — the credit
 * proposal. Failures are logged and never block the creator's journey: the
 * scheduled sweep picks up anything left over.
 */
export async function underwriteIfReady(userId: string, app: { id: string; status: string }) {
  if (app.status !== "inputs_ready") return;
  try {
    await runUnderwriting(getDb(), { userId, applicationId: app.id });
  } catch (error) {
    logger.error("underwriting.run_failed", describeError(error));
    return;
  }
  try {
    await proposeIfShared(await lendingDeps(), { userId, applicationId: app.id });
  } catch (error) {
    logger.error("lending.propose_failed", describeError(error));
  }
}
