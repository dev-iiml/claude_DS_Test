import { and, eq } from "drizzle-orm";

import { providerConfigs, providerRoutes, providerRuntime } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { DEFAULT_CONFIG_KEYS } from "@/providers/catalog";
import { PROVIDER_KINDS } from "@/providers/types";

/**
 * Gives every capability a mock config and a route outside production, so a
 * fresh environment works out of the box. Idempotent and additive: an
 * existing route (e.g. one switched to a live adapter in /ops) is never
 * touched. Production starts with no routes — each capability is configured
 * through the control plane with a real adapter.
 */
export async function publishDefaultProviderRoutes(db: DbExecutor, opts: { production: boolean }) {
  if (opts.production) return { created: 0 };
  let created = 0;
  for (const kind of PROVIDER_KINDS) {
    const [route] = await db
      .select({ kind: providerRoutes.kind })
      .from(providerRoutes)
      .where(eq(providerRoutes.kind, kind))
      .limit(1);
    if (route) continue;
    await db
      .insert(providerConfigs)
      .values({ kind, key: DEFAULT_CONFIG_KEYS[kind], adapter: "mock", mode: "mock", enabled: true })
      .onConflictDoNothing();
    const [config] = await db
      .select({ id: providerConfigs.id })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.kind, kind), eq(providerConfigs.key, DEFAULT_CONFIG_KEYS[kind])))
      .limit(1);
    if (!config) continue;
    await db.insert(providerRuntime).values({ configId: config.id }).onConflictDoNothing();
    await db.insert(providerRoutes).values({ kind, primaryConfigId: config.id }).onConflictDoNothing();
    created += 1;
  }
  return { created };
}
