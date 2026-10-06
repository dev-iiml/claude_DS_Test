import { and, eq, inArray, ne, sql } from "drizzle-orm";

import {
  creditApplications,
  fraudChecks,
  fraudFlags,
  underwritingInputs,
  underwritingResults,
  underwritingRuns,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";

/**
 * Erases underwriting runs of checks not with a lender (all of a creator's,
 * or one check's). Used when financial inputs or creator signals are erased.
 * Must run inside a transaction.
 */
export async function eraseUnderwritingRuns(
  tx: DbExecutor,
  input: {
    userId: string;
    applicationIds?: string[];
    /** The listed checks were vetted as erasable even if sent. */ includeSubmitted?: boolean;
  },
) {
  const apps = await tx
    .select({ id: creditApplications.id })
    .from(creditApplications)
    .where(
      and(
        eq(creditApplications.userId, input.userId),
        input.includeSubmitted && input.applicationIds ? undefined : ne(creditApplications.status, "submitted"),
        input.applicationIds ? inArray(creditApplications.id, input.applicationIds) : undefined,
      ),
    );
  if (!apps.length) return { underwriting_runs: 0 };
  const runs = await tx
    .select({ id: underwritingRuns.id })
    .from(underwritingRuns)
    .where(
      inArray(
        underwritingRuns.applicationId,
        apps.map((a) => a.id),
      ),
    );
  if (!runs.length) return { underwriting_runs: 0 };
  const ids = runs.map((r) => r.id);
  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const checks = await tx.select({ id: fraudChecks.id }).from(fraudChecks).where(inArray(fraudChecks.runId, ids));
  if (checks.length) {
    await tx.delete(fraudFlags).where(
      inArray(
        fraudFlags.checkId,
        checks.map((c) => c.id),
      ),
    );
    await tx.delete(fraudChecks).where(inArray(fraudChecks.runId, ids));
  }
  await tx.delete(underwritingResults).where(inArray(underwritingResults.runId, ids));
  await tx.delete(underwritingInputs).where(inArray(underwritingInputs.runId, ids));
  await tx.delete(underwritingRuns).where(inArray(underwritingRuns.id, ids));
  await tx.execute(sql`set local creatorco.erasure = 'off'`);
  return { underwriting_runs: ids.length };
}
