import { and, eq, lte, sql } from "drizzle-orm";

import { accessRequests } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { releasePoints } from "@/modules/rewards/ledger-service";

/**
 * Withdrawal of the `brand_opportunities` consent (Stage 14).
 *
 * Effect (processing stops): pending requests are cancelled and their points
 * returned. Erasure (scope `access_requests`): every request row, notes
 * included. The points ledger keeps its entries (approved holds stay spent);
 * they reference the erased request only by id. Must run inside a transaction.
 */
export async function cancelPendingAccessRequests(tx: DbExecutor, input: { userId: string; now: Date }) {
  const pending = await tx
    .select({ id: accessRequests.id, creatorId: accessRequests.creatorId })
    .from(accessRequests)
    .where(and(eq(accessRequests.userId, input.userId), eq(accessRequests.status, "requested")))
    .for("update");
  for (const r of pending) {
    await tx
      .update(accessRequests)
      .set({ status: "cancelled", closedAt: input.now })
      .where(and(eq(accessRequests.id, r.id), eq(accessRequests.status, "requested")));
    await releasePoints(tx, { creatorId: r.creatorId, requestId: r.id, now: input.now });
  }
  return pending.length;
}

export async function eraseAccessRequests(
  tx: DbExecutor,
  input: { userId: string; before?: Date },
): Promise<Record<string, number>> {
  // Belt and braces: never erase a pending request with its points still held.
  await cancelPendingAccessRequests(tx, { userId: input.userId, now: new Date() });
  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const rows = await tx
    .delete(accessRequests)
    .where(
      and(
        eq(accessRequests.userId, input.userId),
        input.before ? lte(accessRequests.createdAt, input.before) : undefined,
      ),
    )
    .returning({ id: accessRequests.id });
  await tx.execute(sql`set local creatorco.erasure = 'off'`);
  return { access_requests: rows.length };
}
