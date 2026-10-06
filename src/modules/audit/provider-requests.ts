import { and, count, eq, gt } from "drizzle-orm";

import { providerRequests } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import type { ProviderRequestOutcome } from "@/modules/identity/verification-domain";
import type { ProviderDescriptor } from "@/providers/types";

export interface ProviderCallMeta {
  userId: string | null;
  provider: ProviderDescriptor;
  /** snake_case operation name, e.g. `lookup_by_mobile`. */
  operation: string;
  consentReceiptId?: string | null;
}

/**
 * Calls a provider and records one metadata-only row in `provider_requests`
 * (outcome, reference, duration). Payloads are never recorded. Failures are
 * recorded as `error` and re-thrown.
 */
export async function callProvider<T>(
  db: DbExecutor,
  meta: ProviderCallMeta,
  fn: () => Promise<T>,
  classify: (result: T) => { outcome: ProviderRequestOutcome; reference?: string | null },
): Promise<T> {
  const started = Date.now();
  const row = (outcome: ProviderRequestOutcome, reference: string | null) => ({
    userId: meta.userId,
    providerKind: meta.provider.kind,
    providerKey: meta.provider.key,
    operation: meta.operation,
    outcome,
    providerReference: reference,
    consentReceiptId: meta.consentReceiptId ?? null,
    durationMs: Date.now() - started,
  });
  try {
    const result = await fn();
    const { outcome, reference } = classify(result);
    await db.insert(providerRequests).values(row(outcome, reference ?? null));
    return result;
  } catch (error) {
    await db.insert(providerRequests).values(row("error", null));
    throw error;
  }
}

/** Number of calls a user made to an operation within the window (for throttling). */
export async function countRecentProviderCalls(
  db: DbExecutor,
  input: { userId: string; operation: string; since: Date },
): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(providerRequests)
    .where(
      and(
        eq(providerRequests.userId, input.userId),
        eq(providerRequests.operation, input.operation),
        gt(providerRequests.createdAt, input.since),
      ),
    );
  return r?.n ?? 0;
}
