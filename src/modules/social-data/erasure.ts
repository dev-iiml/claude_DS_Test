import { and, eq, inArray, lte, ne } from "drizzle-orm";

import { creatorSocialAccounts, creatorSocialSnapshots, socialConnectionRequests } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

import { SELF_DECLARED_PROVIDER } from "./domain";

/**
 * Stops all social-data processing for a creator: every connected account is
 * disconnected (declared platforms go back to "self-declared"). Stored data is
 * untouched — erasure is a separate, hold-aware step.
 */
export async function disconnectAllAccounts(db: DbExecutor, input: { creatorId: string; now: Date }): Promise<number> {
  const connected = await db
    .select({ id: creatorSocialAccounts.id, declaredHandle: creatorSocialAccounts.declaredHandle })
    .from(creatorSocialAccounts)
    .where(
      and(
        eq(creatorSocialAccounts.creatorId, input.creatorId),
        eq(creatorSocialAccounts.connectionStatus, "connected"),
      ),
    );
  for (const row of connected) {
    await db
      .update(creatorSocialAccounts)
      .set(
        row.declaredHandle
          ? {
              connectionStatus: "declared",
              handle: row.declaredHandle,
              provider: SELF_DECLARED_PROVIDER,
              externalAccountId: null,
              connectedAt: null,
              accountCreatedAt: null,
              disconnectedAt: null,
            }
          : { connectionStatus: "disconnected", disconnectedAt: input.now },
      )
      .where(eq(creatorSocialAccounts.id, row.id));
  }
  // Pending authorisations can no longer complete.
  await db.delete(socialConnectionRequests).where(eq(socialConnectionRequests.creatorId, input.creatorId));
  return connected.length;
}

/**
 * Erases stored social metrics (all, or those stored up to `before`), and the
 * platform identifiers of accounts that are no longer connected.
 */
export async function eraseSocialAccountData(
  db: DbExecutor,
  input: { creatorId: string; before?: Date },
): Promise<Record<string, number>> {
  const accounts = await db
    .select({ id: creatorSocialAccounts.id })
    .from(creatorSocialAccounts)
    .where(eq(creatorSocialAccounts.creatorId, input.creatorId));
  const ids = accounts.map((a) => a.id);
  const snapshots = ids.length
    ? await db
        .delete(creatorSocialSnapshots)
        .where(
          and(
            inArray(creatorSocialSnapshots.socialAccountId, ids),
            input.before ? lte(creatorSocialSnapshots.createdAt, input.before) : undefined,
          ),
        )
        .returning({ id: creatorSocialSnapshots.id })
    : [];
  const identifiers = await db
    .update(creatorSocialAccounts)
    .set({ externalAccountId: null, accountCreatedAt: null })
    .where(
      and(
        eq(creatorSocialAccounts.creatorId, input.creatorId),
        ne(creatorSocialAccounts.connectionStatus, "connected"),
      ),
    )
    .returning({ id: creatorSocialAccounts.id });
  return { snapshots: snapshots.length, account_identifiers: identifiers.length };
}
