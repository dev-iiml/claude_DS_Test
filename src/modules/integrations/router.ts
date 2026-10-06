import { providerConfigs, providerRoutes, providerRuntime } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { describeError, logger } from "@/lib/logger";
import { findAdapter, type AdapterDefinition, type ProviderByKind } from "@/providers/catalog";
import { classifyProviderError, ProviderError, ProviderRoutingError } from "@/providers/errors";
import { PROVIDER_KINDS, type Provider, type ProviderDescriptor, type ProviderKind } from "@/providers/types";
import { eq } from "drizzle-orm";

import {
  CLOSED_CIRCUIT,
  effectiveCircuitState,
  DEFAULT_TIMEOUT_MS,
  selectRoute,
  type RoutableConfig,
  type RouteSelection,
  type RouteSnapshot,
} from "./domain";
import { claimProbe, recordCallOutcome, type CallOutcome } from "./runtime";

/**
 * Configuration-driven provider routing. For each capability the route picks
 * the primary config, or the fallback while the primary's circuit is open.
 * Every call through a routed provider is timed out, counted and fed to the
 * circuit breaker. A failed call is not retried on another provider: the
 * operation may not be idempotent (OTP, bureau enquiry) and the data it
 * produced is recorded against the provider that served it.
 */

export interface RoutingDeps {
  db: DbExecutor;
  now?: () => Date;
  /** Mock adapters never serve traffic in production. */
  production: boolean;
  /** Routing snapshot cache; 0 disables (tests). */
  cacheTtlMs?: number;
  env?: Record<string, string | undefined>;
}

/** Methods that are synchronous by contract — passed through, never counted. */
const SYNC_METHODS: Partial<Record<ProviderKind, readonly string[]>> = {
  social: ["supportedPlatforms"],
  financial_data: ["capabilities", "interpretReturn"],
  lender: ["proposalProfile", "decisionDelivery"],
};

export interface ConfigRow extends RoutableConfig {
  version: number;
  settings: Record<string, unknown>;
  secretRefs: Record<string, string>;
}

interface Snapshot {
  routes: Map<ProviderKind, RouteSnapshot>;
  configs: Map<string, ConfigRow>;
}

const DEFAULT_CACHE_TTL_MS = 5_000;
// Per database handle, so tests or scripts using another database never see this one's routes.
let cache = new WeakMap<object, { snapshot: Snapshot; expiresAt: number }>();

/** Drops cached routing snapshots (after a config change or circuit transition). */
export function invalidateRoutingCache() {
  cache = new WeakMap();
}

/** True when every secret the adapter declares maps to a set env var. */
export function secretsPresent(
  adapter: AdapterDefinition,
  refs: Record<string, string>,
  env: Record<string, string | undefined>,
) {
  return adapter.secrets.every((name) => {
    const envVar = refs[name];
    return Boolean(envVar && env[envVar]);
  });
}

export async function loadRoutingSnapshot(
  db: DbExecutor,
  env: Record<string, string | undefined> = process.env,
): Promise<Snapshot> {
  const [routes, rows] = await Promise.all([
    db.select().from(providerRoutes),
    db
      .select({ c: providerConfigs, r: providerRuntime })
      .from(providerConfigs)
      .leftJoin(providerRuntime, eq(providerRuntime.configId, providerConfigs.id)),
  ]);
  const configs = new Map<string, ConfigRow>();
  for (const { c, r } of rows) {
    const adapter = findAdapter(c.kind, c.adapter);
    configs.set(c.id, {
      id: c.id,
      kind: c.kind,
      key: c.key,
      adapter: c.adapter,
      mode: c.mode,
      enabled: c.enabled,
      version: c.version,
      settings: c.settings,
      secretRefs: c.secretRefs,
      misconfigured: !adapter || !adapter.modes.includes(c.mode) || !secretsPresent(adapter, c.secretRefs, env),
      circuit: r
        ? { state: r.circuitState, consecutiveFailures: r.consecutiveFailures, openedAt: r.openedAt }
        : CLOSED_CIRCUIT,
    });
  }
  return {
    routes: new Map(
      routes.map((r) => [
        r.kind,
        { kind: r.kind, primaryConfigId: r.primaryConfigId, fallbackConfigId: r.fallbackConfigId, paused: r.paused },
      ]),
    ),
    configs,
  };
}

async function snapshotFor(deps: RoutingDeps): Promise<Snapshot> {
  const ttl = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const hit = cache.get(deps.db);
  if (ttl > 0 && hit && hit.expiresAt > Date.now()) return hit.snapshot;
  const snapshot = await loadRoutingSnapshot(deps.db, deps.env);
  if (ttl > 0) cache.set(deps.db, { snapshot, expiresAt: Date.now() + ttl });
  return snapshot;
}

// Adapter instances are reused per config version (vendor clients are not rebuilt per request).
const instances = new Map<string, Provider>();

export function buildAdapter(config: ConfigRow, env: Record<string, string | undefined> = process.env): Provider {
  const cacheKey = `${config.id}:${config.version}`;
  const existing = instances.get(cacheKey);
  if (existing) return existing;
  const adapter = findAdapter(config.kind, config.adapter);
  if (!adapter) throw new ProviderRoutingError("unavailable", config.kind);
  const secrets: Record<string, string> = {};
  for (const name of adapter.secrets) {
    const value = env[config.secretRefs[name] ?? ""];
    if (!value) throw new ProviderRoutingError("unavailable", config.kind);
    secrets[name] = value;
  }
  const instance = adapter.create({ settings: adapter.settings.parse(config.settings), secrets });
  instances.set(cacheKey, instance);
  return instance;
}

function descriptorOf(config: ConfigRow): ProviderDescriptor {
  return { key: config.key, kind: config.kind, mode: config.mode };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderError("timeout", `provider call exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function instrument(deps: RoutingDeps, config: ConfigRow, adapter: Provider, opts: { probe?: boolean } = {}): Provider {
  const now = deps.now ?? (() => new Date());
  // A cooled-down circuit admits one probe: the first call claims it; if another request already did, this call fails fast.
  let probePending = Boolean(opts.probe);
  async function admit() {
    if (!probePending) return;
    const claimed = await claimProbe(deps.db, config.id, now());
    invalidateRoutingCache();
    if (!claimed) throw new ProviderRoutingError("unavailable", config.kind);
    probePending = false;
  }
  const sync = SYNC_METHODS[config.kind] ?? [];
  const timeoutMs = typeof config.settings.timeoutMs === "number" ? config.settings.timeoutMs : DEFAULT_TIMEOUT_MS;

  async function record(operation: string, outcome: CallOutcome, started: number, startedAt: Date) {
    try {
      const change = await recordCallOutcome(deps.db, {
        configId: config.id,
        configKey: config.key,
        kind: config.kind,
        operation,
        outcome,
        durationMs: Date.now() - started,
        startedAt,
        now: now(),
      });
      if (change) {
        invalidateRoutingCache();
        logger.warn(`integrations.circuit_${change}`, { kind: config.kind, config_key: config.key });
      }
    } catch (error) {
      // Metrics must never break the business call.
      logger.error("integrations.record_failed", describeError(error));
    }
  }

  return new Proxy(adapter, {
    get(target, prop, receiver) {
      if (prop === "descriptor") return descriptorOf(config);
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (prop === "health" || sync.includes(String(prop))) return fn.bind(target);
      const operation = String(prop);
      return async (...args: unknown[]) => {
        await admit();
        const started = Date.now();
        const startedAt = now();
        try {
          const result = await withTimeout(Promise.resolve(fn.apply(target, args)), timeoutMs);
          await record(operation, "success", started, startedAt);
          return result;
        } catch (error) {
          const outcome = classifyProviderError(error) === "rejected" ? "rejection" : "failure";
          await record(operation, outcome, started, startedAt);
          throw error;
        }
      };
    },
  });
}

/**
 * Stand-in when no config can serve a capability. Its descriptor is the
 * primary's (so code that records a provider key still works) and every
 * asynchronous call fails with a routing error before any vendor is called.
 */
function unavailable(
  kind: ProviderKind,
  code: "paused" | "unavailable" | "not_configured",
  configured: ConfigRow | undefined,
  deps: RoutingDeps,
): Provider {
  const env = deps.env ?? process.env;
  // A mock left as primary in production is never exposed (its descriptor would re-enable mock-only pages).
  const primary = configured && !(deps.production && configured.mode === "mock") ? configured : undefined;
  const descriptor: ProviderDescriptor = primary ? descriptorOf(primary) : { key: "unconfigured", kind, mode: "live" };
  const sync = SYNC_METHODS[kind] ?? [];
  let delegate: Provider | null = null;
  return new Proxy({} as Provider, {
    get(_t, prop) {
      if (prop === "descriptor") return descriptor;
      if (prop === "then") return undefined; // not a thenable
      if (prop === "health") return async () => ({ status: "down" as const, checkedAt: new Date() });
      if (sync.includes(String(prop)) && primary) {
        try {
          delegate ??= buildAdapter(primary, env);
          const fn = Reflect.get(delegate, prop) as (...a: unknown[]) => unknown;
          return fn.bind(delegate);
        } catch {
          return () => [];
        }
      }
      return async () => {
        throw new ProviderRoutingError(code, kind);
      };
    },
  });
}

export interface ResolvedProvider<K extends ProviderKind> {
  provider: ProviderByKind[K];
  selection: RouteSelection;
}

function resolveFrom<K extends ProviderKind>(deps: RoutingDeps, snapshot: Snapshot, kind: K): ResolvedProvider<K> {
  const env = deps.env ?? process.env;
  const route = snapshot.routes.get(kind);
  const now = (deps.now ?? (() => new Date()))();
  const selection = selectRoute(route, snapshot.configs, { now, production: deps.production });
  const primary = route ? snapshot.configs.get(route.primaryConfigId) : undefined;
  if (selection.status === "ok") {
    const config = snapshot.configs.get(selection.config.id)!;
    const probe = effectiveCircuitState(config.circuit, now) === "half_open";
    try {
      const provider = instrument(deps, config, buildAdapter(config, env), { probe }) as ProviderByKind[K];
      return { provider, selection };
    } catch (error) {
      logger.error("integrations.adapter_build_failed", { kind, ...describeError(error) });
      return { provider: unavailable(kind, "unavailable", primary, deps) as ProviderByKind[K], selection };
    }
  }
  return { provider: unavailable(kind, selection.status, primary, deps) as ProviderByKind[K], selection };
}

/**
 * The provider for a specific config key — for the return leg of a flow that
 * a config started (OAuth callback, Account Aggregator consent), so a later
 * switch of the primary doesn't strand it. Null when that config can no
 * longer serve (disabled, misconfigured, mock in production): the flow must
 * start again. A paused capability yields a stand-in that fails as paused.
 */
export async function resolveProviderByKey<K extends ProviderKind>(
  deps: RoutingDeps,
  kind: K,
  key: string,
): Promise<ProviderByKind[K] | null> {
  const snapshot = await snapshotFor(deps);
  const config = [...snapshot.configs.values()].find((c) => c.kind === kind && c.key === key);
  if (!config || !config.enabled || config.misconfigured || (deps.production && config.mode === "mock")) return null;
  if (snapshot.routes.get(kind)?.paused) return unavailable(kind, "paused", config, deps) as ProviderByKind[K];
  try {
    return instrument(deps, config, buildAdapter(config, deps.env ?? process.env)) as ProviderByKind[K];
  } catch {
    return null;
  }
}

export async function resolveProvider<K extends ProviderKind>(deps: RoutingDeps, kind: K) {
  return resolveFrom(deps, await snapshotFor(deps), kind);
}

export async function resolveAllProviders(deps: RoutingDeps): Promise<{ [K in ProviderKind]: ProviderByKind[K] }> {
  const snapshot = await snapshotFor(deps);
  const out = {} as { [K in ProviderKind]: ProviderByKind[K] };
  for (const kind of PROVIDER_KINDS) {
    (out as Record<ProviderKind, Provider>)[kind] = resolveFrom(deps, snapshot, kind).provider;
  }
  return out;
}
