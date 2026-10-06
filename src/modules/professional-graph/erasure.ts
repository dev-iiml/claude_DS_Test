import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { creatorProfessionalFeatures, professionalGraphRuns } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

/**
 * Erases Professional Graph runs (and their features) (all, or those stored up to `before`).
 * Runs and features are otherwise append-only; the database permits deletes
 * only inside a transaction that sets `creatorco.erasure` (migration 0007).
 * Must be called inside a transaction.
 */
export async function eraseProfessionalGraph(
  tx: DbExecutor,
  input: { creatorId: string; before?: Date },
): Promise<Record<string, number>> {
  const runs = await tx
    .select({ id: professionalGraphRuns.id })
    .from(professionalGraphRuns)
    .where(
      and(
        eq(professionalGraphRuns.creatorId, input.creatorId),
        input.before ? lte(professionalGraphRuns.createdAt, input.before) : undefined,
      ),
    );
  if (!runs.length) return { runs: 0, features: 0 };
  const ids = runs.map((r) => r.id);

  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const features = await tx
    .delete(creatorProfessionalFeatures)
    .where(inArray(creatorProfessionalFeatures.runId, ids))
    .returning({ id: creatorProfessionalFeatures.id });
  await tx.delete(professionalGraphRuns).where(inArray(professionalGraphRuns.id, ids));
  await tx.execute(sql`set local creatorco.erasure = 'off'`);
  return { runs: ids.length, features: features.length };
}
