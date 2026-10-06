import { inArray, sql } from "drizzle-orm";

import { creditProposals } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

/**
 * Erases CreatorCo's lender records for checks whose lender relationship has
 * closed (lender declined, creator declined, offer expired) when the creator
 * withdraws consent (Stage 13 user decision: keep everything until then).
 * Deleting the proposals removes their frozen payloads, decisions, queries,
 * reviews, offer answers and partner events (cascade). The partner lender
 * keeps its own copy under its retention rules; audit events (ids only) stay.
 * Must run inside a transaction.
 */
export async function eraseLenderRecords(tx: DbExecutor, applicationIds: string[]) {
  if (!applicationIds.length) return { proposals: 0 };
  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const rows = await tx
    .delete(creditProposals)
    .where(inArray(creditProposals.applicationId, applicationIds))
    .returning({ id: creditProposals.id });
  await tx.execute(sql`set local creatorco.erasure = 'off'`);
  return { proposals: rows.length };
}
