import "server-only";

import { getDb } from "@/db";
import { getProviderByKey, getProviders } from "@/modules/integrations/registry";
import type { LendingDeps } from "@/modules/lending";

/** Lending dependencies for routes: the routed partner lender, plus pinned configs for proposals already in flight. */
export async function lendingDeps(): Promise<LendingDeps> {
  return {
    db: getDb(),
    lender: (await getProviders()).lender,
    lenderFor: (key) => getProviderByKey("lender", key),
  };
}
