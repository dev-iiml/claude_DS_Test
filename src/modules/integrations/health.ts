import { eq } from "drizzle-orm";

import { providerRuntime } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

import type { HealthStatus } from "./domain";
import { buildAdapter, loadRoutingSnapshot } from "./router";

const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Calls `health()` on every enabled config and records the result. Health is
 * informational (shown in /ops); routing reacts to real call failures via the
 * circuit breaker, so a flaky health endpoint can't take a provider offline.
 */
export async function runHealthChecks(deps: { db: DbExecutor; now?: Date; production: boolean }) {
  const snapshot = await loadRoutingSnapshot(deps.db);
  let checked = 0;
  let down = 0;
  for (const config of snapshot.configs.values()) {
    if (!config.enabled) continue;
    let status: HealthStatus = "down";
    const started = Date.now();
    if (!config.misconfigured && !(deps.production && config.mode === "mock")) {
      try {
        const adapter = buildAdapter(config);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          adapter.health(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS);
          }),
        ]).finally(() => clearTimeout(timer));
        status = result.status;
      } catch {
        status = "down";
      }
    }
    const latency = Date.now() - started;
    await deps.db.insert(providerRuntime).values({ configId: config.id }).onConflictDoNothing();
    await deps.db
      .update(providerRuntime)
      .set({ healthStatus: status, healthCheckedAt: deps.now ?? new Date(), healthLatencyMs: latency })
      .where(eq(providerRuntime.configId, config.id));
    checked += 1;
    if (status === "down") down += 1;
  }
  return { checked, down };
}
