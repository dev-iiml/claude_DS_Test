import { and, eq, lte } from "drizzle-orm";

import { creatorProfiles, identityLookupResults } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

/**
 * Erases identity-lookup results (verified name, masked PAN) (all, or those
 * fetched up to `before`). The creator's legal name stays on their profile, now marked as
 * self-declared because its verification evidence is gone.
 */
export async function eraseIdentityLookups(
  db: DbExecutor,
  input: { userId: string; before?: Date },
): Promise<Record<string, number>> {
  const erased = await db
    .delete(identityLookupResults)
    .where(
      and(
        eq(identityLookupResults.userId, input.userId),
        input.before ? lte(identityLookupResults.fetchedAt, input.before) : undefined,
      ),
    )
    .returning({ id: identityLookupResults.userId });
  await db
    .update(creatorProfiles)
    .set({ legalNameSource: "self_declared" })
    .where(eq(creatorProfiles.userId, input.userId));
  return { lookups: erased.length };
}
