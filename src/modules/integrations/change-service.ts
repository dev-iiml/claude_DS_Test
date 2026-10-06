import { and, eq, lte, or } from "drizzle-orm";

import { integrationChangeRequests, providerConfigs, providerRoutes, providerRuntime } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { findAdapter, type AdapterDefinition } from "@/providers/catalog";
import type { ProviderKind, ProviderMode } from "@/providers/types";

import { changeExpiresAt, requiresApproval, type ApprovalContext, type ChangeAction } from "./domain";
import { invalidateRoutingCache } from "./router";
import type { ChangeInput } from "./schemas";

/**
 * Maker-checker for the integration control plane. Every change is recorded
 * as a request; risky ones wait for a second ops admin, the kill switch
 * applies at once. Approval re-checks the versions the request was based on,
 * so a stale request is marked `superseded` rather than overwriting newer
 * configuration.
 */

export type IntegrationChangeErrorCode =
  "invalid" | "not_found" | "self_approval" | "not_pending" | "expired" | "superseded";

export class IntegrationChangeError extends Error {
  constructor(
    readonly code: IntegrationChangeErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "IntegrationChangeError";
  }
}

export interface ChangeDeps {
  db: DbExecutor;
  now?: Date;
  /** Mock configs are refused in production. */
  production: boolean;
}

type RequestRow = typeof integrationChangeRequests.$inferSelect;

interface ConfigChanges {
  mode?: ProviderMode;
  enabled?: boolean;
  settings?: Record<string, unknown>;
  secretRefs?: Record<string, string>;
}

interface PreparedChange {
  action: ChangeAction;
  kind: ProviderKind;
  configId: string | null;
  payload: Record<string, unknown>;
  approval: ApprovalContext;
  baseRouteVersion: number | null;
  baseConfigVersion: number | null;
}

const invalid = (message: string) => new IntegrationChangeError("invalid", message);

function validateForAdapter(
  adapter: AdapterDefinition,
  input: { mode: ProviderMode; settings: Record<string, unknown>; secretRefs: Record<string, string> },
  production: boolean,
) {
  if (!adapter.modes.includes(input.mode)) throw invalid(`${adapter.label} can't run in ${input.mode} mode.`);
  if (production && input.mode === "mock") throw invalid("Mock providers can't be used in production.");
  const settings = adapter.settings.safeParse(input.settings);
  if (!settings.success) {
    throw invalid(
      `Settings aren't valid for ${adapter.label}: ${settings.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const declared = new Set(adapter.secrets);
  const unknown = Object.keys(input.secretRefs).filter((k) => !declared.has(k));
  if (unknown.length) throw invalid(`${adapter.label} doesn't use: ${unknown.join(", ")}.`);
  const missing = adapter.secrets.filter((k) => !input.secretRefs[k]);
  if (missing.length) throw invalid(`Map every secret to an env var: ${missing.join(", ")}.`);
  return settings.data;
}

async function routeFor(db: DbExecutor, kind: ProviderKind) {
  const [route] = await db.select().from(providerRoutes).where(eq(providerRoutes.kind, kind)).limit(1);
  return route ?? null;
}

async function isRouted(db: DbExecutor, configId: string) {
  const rows = await db
    .select({ kind: providerRoutes.kind })
    .from(providerRoutes)
    .where(or(eq(providerRoutes.primaryConfigId, configId), eq(providerRoutes.fallbackConfigId, configId)))
    .limit(1);
  return rows.length > 0;
}

async function configById(db: DbExecutor, id: string) {
  const [config] = await db.select().from(providerConfigs).where(eq(providerConfigs.id, id)).limit(1);
  return config ?? null;
}

async function prepare(deps: ChangeDeps, input: ChangeInput): Promise<PreparedChange> {
  const { db, production } = deps;
  switch (input.action) {
    case "create_config": {
      const adapter = findAdapter(input.kind, input.adapter);
      if (!adapter) throw invalid("That adapter isn't available in this build.");
      const settings = validateForAdapter(adapter, input, production);
      const [taken] = await db
        .select({ id: providerConfigs.id })
        .from(providerConfigs)
        .where(and(eq(providerConfigs.kind, input.kind), eq(providerConfigs.key, input.key)))
        .limit(1);
      if (taken) throw invalid(`The key "${input.key}" is already used for this capability.`);
      return {
        action: input.action,
        kind: input.kind,
        configId: null,
        payload: { ...input, settings },
        approval: { action: input.action, targetMode: input.mode },
        baseRouteVersion: null,
        baseConfigVersion: null,
      };
    }
    case "update_config": {
      const config = await configById(db, input.configId);
      if (!config) throw new IntegrationChangeError("not_found");
      const adapter = findAdapter(config.kind, config.adapter);
      if (!adapter) throw invalid("This config's adapter isn't available in this build.");
      const next = {
        mode: input.mode ?? config.mode,
        settings: input.settings ?? config.settings,
        secretRefs: input.secretRefs ?? config.secretRefs,
      };
      const settings = validateForAdapter(adapter, next, production);
      const changes: ConfigChanges = {};
      if (input.mode !== undefined && input.mode !== config.mode) changes.mode = input.mode;
      if (input.enabled !== undefined && input.enabled !== config.enabled) changes.enabled = input.enabled;
      if (input.settings !== undefined && JSON.stringify(settings) !== JSON.stringify(config.settings))
        changes.settings = settings;
      if (input.secretRefs !== undefined && JSON.stringify(input.secretRefs) !== JSON.stringify(config.secretRefs))
        changes.secretRefs = input.secretRefs;
      if (!Object.keys(changes).length) throw invalid("Nothing would change.");
      return {
        action: input.action,
        kind: config.kind,
        configId: config.id,
        payload: { configId: config.id, configKey: config.key, changes },
        approval: {
          action: input.action,
          currentMode: config.mode,
          targetMode: changes.mode,
          configIsRouted: await isRouted(db, config.id),
        },
        baseRouteVersion: null,
        baseConfigVersion: config.version,
      };
    }
    case "set_route": {
      if (input.fallbackConfigId === input.primaryConfigId) throw invalid("The fallback must differ from the primary.");
      // The approver approves these exact config versions; any later edit supersedes the request.
      const configVersions: Record<string, number> = {};
      for (const id of [input.primaryConfigId, input.fallbackConfigId]) {
        if (!id) continue;
        const config = await configById(db, id);
        if (!config || config.kind !== input.kind) throw invalid("Choose configs for this capability.");
        if (!config.enabled) throw invalid(`Enable "${config.key}" before routing traffic to it.`);
        if (production && config.mode === "mock") throw invalid("Mock providers can't be used in production.");
        configVersions[id] = config.version;
      }
      const route = await routeFor(db, input.kind);
      if (route && route.primaryConfigId === input.primaryConfigId && route.fallbackConfigId === input.fallbackConfigId)
        throw invalid("Nothing would change.");
      return {
        action: input.action,
        kind: input.kind,
        configId: null,
        payload: {
          primaryConfigId: input.primaryConfigId,
          fallbackConfigId: input.fallbackConfigId,
          configVersions,
        },
        approval: { action: input.action },
        baseRouteVersion: route?.version ?? null,
        baseConfigVersion: null,
      };
    }
    case "pause_kind":
    case "resume_kind": {
      const route = await routeFor(db, input.kind);
      if (!route) throw invalid("This capability has no route yet.");
      if (input.action === "pause_kind" && route.paused) throw invalid("Already paused.");
      if (input.action === "resume_kind" && !route.paused) throw invalid("Not paused.");
      return {
        action: input.action,
        kind: input.kind,
        configId: null,
        payload: {},
        approval: { action: input.action },
        baseRouteVersion: route.version,
        baseConfigVersion: null,
      };
    }
  }
}

/** Applies a change inside the caller's transaction. Returns the config created, or "superseded". */
async function apply(
  tx: DbExecutor,
  req: Pick<
    RequestRow,
    | "action"
    | "kind"
    | "configId"
    | "payload"
    | "reason"
    | "requestedBy"
    | "baseRouteVersion"
    | "baseConfigVersion"
    | "approvalRequired"
  >,
  now: Date,
  production: boolean,
): Promise<{ configId: string | null } | "superseded"> {
  const p = req.payload;
  switch (req.action) {
    case "create_config": {
      const [created] = await tx
        .insert(providerConfigs)
        .values({
          kind: req.kind,
          key: String(p.key),
          adapter: String(p.adapter),
          mode: p.mode as ProviderMode,
          enabled: Boolean(p.enabled),
          settings: p.settings as Record<string, unknown>,
          secretRefs: p.secretRefs as Record<string, string>,
          createdBy: req.requestedBy,
        })
        .onConflictDoNothing()
        .returning({ id: providerConfigs.id });
      if (!created) return "superseded";
      await tx.insert(providerRuntime).values({ configId: created.id });
      return { configId: created.id };
    }
    case "update_config": {
      const [config] = await tx
        .select()
        .from(providerConfigs)
        .where(eq(providerConfigs.id, req.configId!))
        .for("update");
      if (!config || config.version !== req.baseConfigVersion) return "superseded";
      const changes = p.changes as ConfigChanges;
      if (production && (changes.mode ?? config.mode) === "mock") return "superseded";
      // An unreviewed (instant) edit must not land on a config that became routed meanwhile.
      if (!req.approvalRequired) {
        const routes = await tx
          .select({ kind: providerRoutes.kind })
          .from(providerRoutes)
          .where(or(eq(providerRoutes.primaryConfigId, config.id), eq(providerRoutes.fallbackConfigId, config.id)))
          .for("update");
        if (routes.length) return "superseded";
      }
      await tx
        .update(providerConfigs)
        .set({ ...changes, version: config.version + 1 })
        .where(eq(providerConfigs.id, config.id));
      if (changes.settings || changes.mode) {
        // A config change starts with a fresh circuit.
        await tx
          .update(providerRuntime)
          .set({ circuitState: "closed", consecutiveFailures: 0, openedAt: null })
          .where(eq(providerRuntime.configId, config.id));
      }
      return { configId: config.id };
    }
    case "set_route": {
      const [route] = await tx.select().from(providerRoutes).where(eq(providerRoutes.kind, req.kind)).for("update");
      if ((route?.version ?? null) !== req.baseRouteVersion) return "superseded";
      const primaryConfigId = String(p.primaryConfigId);
      const fallbackConfigId = (p.fallbackConfigId as string | null) ?? null;
      const versions = (p.configVersions ?? {}) as Record<string, number>;
      for (const id of [primaryConfigId, fallbackConfigId]) {
        if (!id) continue;
        const [c] = await tx.select().from(providerConfigs).where(eq(providerConfigs.id, id)).for("share");
        if (!c?.enabled || c.kind !== req.kind || c.version !== versions[id]) return "superseded";
      }
      if (route) {
        await tx
          .update(providerRoutes)
          .set({ primaryConfigId, fallbackConfigId, version: route.version + 1 })
          .where(eq(providerRoutes.kind, req.kind));
      } else {
        const inserted = await tx
          .insert(providerRoutes)
          .values({ kind: req.kind, primaryConfigId, fallbackConfigId })
          .onConflictDoNothing()
          .returning({ kind: providerRoutes.kind });
        if (!inserted.length) return "superseded";
      }
      return { configId: null };
    }
    case "pause_kind":
    case "resume_kind": {
      const [route] = await tx.select().from(providerRoutes).where(eq(providerRoutes.kind, req.kind)).for("update");
      const pausing = req.action === "pause_kind";
      // The kill switch must work mid-incident: no version check, only "not already paused".
      if (!route || (pausing ? route.paused : route.version !== req.baseRouteVersion)) return "superseded";
      await tx
        .update(providerRoutes)
        .set({
          paused: pausing,
          pausedReason: pausing ? req.reason : null,
          pausedAt: pausing ? now : null,
          pausedBy: pausing ? req.requestedBy : null,
          version: route.version + 1,
        })
        .where(eq(providerRoutes.kind, req.kind));
      return { configId: null };
    }
  }
}

function auditMeta(req: { action: ChangeAction; kind: ProviderKind; approvalRequired: boolean }) {
  return { action: req.action, kind: req.kind, approval_required: req.approvalRequired };
}

export async function proposeChange(
  deps: ChangeDeps,
  input: { actorId: string; change: ChangeInput; reason: string },
): Promise<{ id: string; status: "pending" | "applied" }> {
  const now = deps.now ?? new Date();
  const prepared = await prepare(deps, input.change);
  const approvalRequired = requiresApproval(prepared.approval);
  const base = {
    action: prepared.action,
    kind: prepared.kind,
    configId: prepared.configId,
    payload: prepared.payload,
    reason: input.reason,
    requestedBy: input.actorId,
    baseRouteVersion: prepared.baseRouteVersion,
    baseConfigVersion: prepared.baseConfigVersion,
  };

  const result = await deps.db.transaction(async (tx) => {
    if (approvalRequired) {
      const [row] = await tx
        .insert(integrationChangeRequests)
        .values({ ...base, approvalRequired, status: "pending", requestedAt: now, expiresAt: changeExpiresAt(now) })
        .returning({ id: integrationChangeRequests.id });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.actorId,
        eventType: "integrations.change_requested",
        entityType: "integration_change_request",
        entityId: row!.id,
        metadata: auditMeta({ ...prepared, approvalRequired }),
      });
      return { id: row!.id, status: "pending" as const };
    }
    const applied = await apply(tx, { ...base, approvalRequired }, now, deps.production);
    if (applied === "superseded") throw invalid("The configuration changed meanwhile. Please review and try again.");
    const [row] = await tx
      .insert(integrationChangeRequests)
      .values({
        ...base,
        configId: applied.configId ?? base.configId,
        approvalRequired,
        status: "applied",
        requestedAt: now,
        appliedAt: now,
      })
      .returning({ id: integrationChangeRequests.id });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.actorId,
      eventType: prepared.action === "pause_kind" ? "integrations.kill_switch_engaged" : "integrations.change_applied",
      entityType: "integration_change_request",
      entityId: row!.id,
      metadata: auditMeta({ ...prepared, approvalRequired }),
    });
    return { id: row!.id, status: "applied" as const };
  });
  if (result.status === "applied") invalidateRoutingCache();
  return result;
}

async function lockPending(tx: DbExecutor, requestId: string) {
  const [req] = await tx
    .select()
    .from(integrationChangeRequests)
    .where(eq(integrationChangeRequests.id, requestId))
    .for("update");
  if (!req) throw new IntegrationChangeError("not_found");
  if (req.status !== "pending")
    throw new IntegrationChangeError("not_pending", "This request has already been decided.");
  return req;
}

/** Approves and applies a pending change. The approver must not be the requester. */
export async function approveChange(
  deps: ChangeDeps,
  input: { actorId: string; requestId: string; note?: string },
): Promise<{ status: "applied" }> {
  const now = deps.now ?? new Date();
  const outcome = await deps.db.transaction(async (tx) => {
    const req = await lockPending(tx, input.requestId);
    if (req.requestedBy === input.actorId)
      throw new IntegrationChangeError("self_approval", "Someone else must approve a change you requested.");
    const decided = { decidedBy: input.actorId, decidedAt: now, decisionNote: input.note || null };
    if (req.expiresAt && req.expiresAt <= now) {
      await tx
        .update(integrationChangeRequests)
        .set({ status: "expired", ...decided, decidedBy: null })
        .where(eq(integrationChangeRequests.id, req.id));
      return "expired" as const;
    }
    const applied = await apply(tx, req, now, deps.production);
    if (applied === "superseded") {
      await tx
        .update(integrationChangeRequests)
        .set({ status: "superseded", ...decided })
        .where(eq(integrationChangeRequests.id, req.id));
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.actorId,
        eventType: "integrations.change_superseded",
        entityType: "integration_change_request",
        entityId: req.id,
        metadata: auditMeta(req),
      });
      return "superseded" as const;
    }
    await tx
      .update(integrationChangeRequests)
      .set({ status: "applied", ...decided, appliedAt: now, configId: applied.configId ?? req.configId })
      .where(eq(integrationChangeRequests.id, req.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.actorId,
      eventType: req.action === "resume_kind" ? "integrations.kill_switch_released" : "integrations.change_approved",
      entityType: "integration_change_request",
      entityId: req.id,
      metadata: auditMeta(req),
    });
    return "applied" as const;
  });
  if (outcome === "expired")
    throw new IntegrationChangeError("expired", "This request expired. Raise it again if it's still needed.");
  if (outcome === "superseded")
    throw new IntegrationChangeError("superseded", "The configuration changed after this request. Raise a new one.");
  invalidateRoutingCache();
  return { status: "applied" };
}

/** The requester cancels; anyone else rejects. */
export async function rejectChange(
  deps: ChangeDeps,
  input: { actorId: string; requestId: string; note?: string },
): Promise<{ status: "rejected" | "cancelled" | "expired" }> {
  const now = deps.now ?? new Date();
  return deps.db.transaction(async (tx) => {
    const req = await lockPending(tx, input.requestId);
    if (req.expiresAt && req.expiresAt <= now) {
      await tx
        .update(integrationChangeRequests)
        .set({ status: "expired" })
        .where(eq(integrationChangeRequests.id, req.id));
      return { status: "expired" as const };
    }
    const status = req.requestedBy === input.actorId ? ("cancelled" as const) : ("rejected" as const);
    await tx
      .update(integrationChangeRequests)
      .set({ status, decidedBy: input.actorId, decidedAt: now, decisionNote: input.note || null })
      .where(eq(integrationChangeRequests.id, req.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.actorId,
      eventType: `integrations.change_${status}`,
      entityType: "integration_change_request",
      entityId: req.id,
      metadata: auditMeta(req),
    });
    return { status };
  });
}

/** Marks pending requests past their expiry. */
export async function expireStaleChanges(deps: Pick<ChangeDeps, "db" | "now">) {
  const now = deps.now ?? new Date();
  const rows = await deps.db
    .update(integrationChangeRequests)
    .set({ status: "expired" })
    .where(and(eq(integrationChangeRequests.status, "pending"), lte(integrationChangeRequests.expiresAt, now)))
    .returning({ id: integrationChangeRequests.id });
  return rows.length;
}
