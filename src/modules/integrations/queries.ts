import { aliasedTable, and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import {
  integrationChangeRequests,
  providerCallStats,
  providerConfigs,
  providerRoutes,
  providerRuntime,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { findAdapter } from "@/providers/catalog";
import { PROVIDER_KINDS, type ProviderKind } from "@/providers/types";

import {
  effectiveCircuitState,
  PROVIDER_KIND_LABELS,
  selectRoute,
  type ChangeStatus,
  type HealthStatus,
  type RouteSelection,
} from "./domain";
import { loadRoutingSnapshot } from "./router";

/** Read models for the /ops console. No creator or financial data; secret refs show presence only. */

export interface ConfigView {
  id: string;
  key: string;
  adapter: string;
  adapterLabel: string;
  mode: "mock" | "sandbox" | "live";
  enabled: boolean;
  version: number;
  role: "primary" | "fallback" | null;
  misconfigured: boolean;
  circuit: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  openedAt: Date | null;
  health: HealthStatus;
  healthCheckedAt: Date | null;
  healthLatencyMs: number | null;
  settings: Record<string, unknown>;
  secrets: { name: string; envVar: string | null; present: boolean }[];
  calls24h: { successes: number; failures: number; rejections: number; avgMs: number | null };
}

export interface KindView {
  kind: ProviderKind;
  label: string;
  route: { paused: boolean; pausedReason: string | null; pausedAt: Date | null; version: number } | null;
  selection: RouteSelection;
  serving: string | null;
  configs: ConfigView[];
  pendingChanges: number;
}

export async function getIntegrationsOverview(
  db: DbExecutor,
  opts: { now?: Date; production: boolean; env?: Record<string, string | undefined> },
): Promise<KindView[]> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [snapshot, routes, runtime, stats, pending] = await Promise.all([
    loadRoutingSnapshot(db, env),
    db.select().from(providerRoutes),
    db.select().from(providerRuntime),
    db
      .select({
        configId: providerCallStats.configId,
        successes: sql<number>`sum(${providerCallStats.successes})::int`,
        failures: sql<number>`sum(${providerCallStats.failures})::int`,
        rejections: sql<number>`sum(${providerCallStats.rejections})::int`,
        totalMs: sql<number>`sum(${providerCallStats.totalDurationMs})::bigint`,
      })
      .from(providerCallStats)
      .where(gte(providerCallStats.bucket, since))
      .groupBy(providerCallStats.configId),
    db
      .select({ kind: integrationChangeRequests.kind, n: sql<number>`count(*)::int` })
      .from(integrationChangeRequests)
      .where(eq(integrationChangeRequests.status, "pending"))
      .groupBy(integrationChangeRequests.kind),
  ]);
  const runtimeById = new Map(runtime.map((r) => [r.configId, r]));
  const statsById = new Map(stats.map((s) => [s.configId, s]));
  const pendingByKind = new Map(pending.map((p) => [p.kind, p.n]));
  const routeByKind = new Map(routes.map((r) => [r.kind, r]));

  return PROVIDER_KINDS.map((kind) => {
    const route = routeByKind.get(kind);
    const routeSnapshot = snapshot.routes.get(kind);
    const selection = selectRoute(routeSnapshot, snapshot.configs, { now, production: opts.production });
    const configs: ConfigView[] = [...snapshot.configs.values()]
      .filter((c) => c.kind === kind)
      .map((c) => {
        const adapter = findAdapter(kind, c.adapter);
        const rt = runtimeById.get(c.id);
        const st = statsById.get(c.id);
        const calls = (st?.successes ?? 0) + (st?.failures ?? 0) + (st?.rejections ?? 0);
        return {
          id: c.id,
          key: c.key,
          adapter: c.adapter,
          adapterLabel: adapter?.label ?? `${c.adapter} (not in this build)`,
          mode: c.mode,
          enabled: c.enabled,
          version: c.version,
          role: route?.primaryConfigId === c.id ? "primary" : route?.fallbackConfigId === c.id ? "fallback" : null,
          misconfigured: c.misconfigured,
          circuit: c.circuit.state === "half_open" ? "half_open" : effectiveCircuitState(c.circuit, now),
          consecutiveFailures: c.circuit.consecutiveFailures,
          openedAt: c.circuit.openedAt,
          health: rt?.healthStatus ?? "unknown",
          healthCheckedAt: rt?.healthCheckedAt ?? null,
          healthLatencyMs: rt?.healthLatencyMs ?? null,
          settings: c.settings,
          secrets: (adapter?.secrets ?? Object.keys(c.secretRefs)).map((name) => {
            const envVar = c.secretRefs[name] ?? null;
            return { name, envVar, present: Boolean(envVar && env[envVar]) };
          }),
          calls24h: {
            successes: st?.successes ?? 0,
            failures: st?.failures ?? 0,
            rejections: st?.rejections ?? 0,
            avgMs: calls ? Math.round(Number(st?.totalMs ?? 0) / calls) : null,
          },
        } satisfies ConfigView;
      })
      .sort((a, b) => rank(a.role) - rank(b.role) || a.key.localeCompare(b.key));
    return {
      kind,
      label: PROVIDER_KIND_LABELS[kind],
      route: route
        ? { paused: route.paused, pausedReason: route.pausedReason, pausedAt: route.pausedAt, version: route.version }
        : null,
      selection,
      serving: selection.status === "ok" ? selection.config.key : null,
      configs,
      pendingChanges: pendingByKind.get(kind) ?? 0,
    };
  });
}

const rank = (role: ConfigView["role"]) => (role === "primary" ? 0 : role === "fallback" ? 1 : 2);

export interface ChangeRequestView {
  id: string;
  action: string;
  kind: ProviderKind;
  configKey: string | null;
  payload: Record<string, unknown>;
  reason: string;
  approvalRequired: boolean;
  status: ChangeStatus;
  requestedBy: string;
  requestedByEmail: string | null;
  requestedAt: Date;
  expiresAt: Date | null;
  decidedByEmail: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export async function listChangeRequests(
  db: DbExecutor,
  opts: { pending: boolean; limit?: number; kind?: ProviderKind },
): Promise<ChangeRequestView[]> {
  const requester = aliasedTable(users, "requester");
  const decider = aliasedTable(users, "decider");
  const rows = await db
    .select({
      r: integrationChangeRequests,
      configKey: providerConfigs.key,
      requestedByEmail: requester.email,
      decidedByEmail: decider.email,
    })
    .from(integrationChangeRequests)
    .leftJoin(providerConfigs, eq(providerConfigs.id, integrationChangeRequests.configId))
    .leftJoin(requester, eq(requester.id, integrationChangeRequests.requestedBy))
    .leftJoin(decider, eq(decider.id, integrationChangeRequests.decidedBy))
    .where(
      and(
        opts.pending
          ? eq(integrationChangeRequests.status, "pending")
          : ne(integrationChangeRequests.status, "pending"),
        opts.kind ? eq(integrationChangeRequests.kind, opts.kind) : undefined,
      ),
    )
    .orderBy(desc(integrationChangeRequests.requestedAt))
    .limit(opts.limit ?? 50);
  return rows.map(({ r, configKey, requestedByEmail, decidedByEmail }) => ({
    id: r.id,
    action: r.action,
    kind: r.kind,
    configKey: configKey ?? (typeof r.payload.key === "string" ? r.payload.key : null),
    payload: r.payload,
    reason: r.reason,
    approvalRequired: r.approvalRequired,
    status: r.status,
    requestedBy: r.requestedBy,
    requestedByEmail,
    requestedAt: r.requestedAt,
    expiresAt: r.expiresAt,
    decidedByEmail,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
  }));
}

/** Config keys by id, for describing route changes. */
export async function configKeys(db: DbExecutor, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ id: providerConfigs.id, key: providerConfigs.key })
    .from(providerConfigs)
    .where(inArray(providerConfigs.id, ids));
  return new Map(rows.map((r) => [r.id, r.key]));
}

export async function countPendingChanges(db: DbExecutor) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(integrationChangeRequests)
    .where(eq(integrationChangeRequests.status, "pending"));
  return r?.n ?? 0;
}
