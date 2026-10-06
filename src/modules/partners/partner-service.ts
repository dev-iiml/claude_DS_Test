import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  partnerApiKeys,
  partnerEvents,
  partnerWebhookDeliveries,
  partnerWebhookEndpoints,
  partners,
  providerConfigs,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import { apiKeyMatches, deriveWebhookSecret, generateApiKey } from "./credentials";
import {
  DEFAULT_KEY_LIFETIME_DAYS,
  KEY_LIFETIME_DAYS,
  LAST_USED_RESOLUTION_MS,
  PARTNER_ENVIRONMENTS,
  PARTNER_KEY_PATTERN,
  PARTNER_SCOPES,
  ROTATION_OVERLAP_HOURS,
  WEBHOOK_SECRET_OVERLAP_HOURS,
  keyIsUsable,
  parseApiKey,
  pendingExpired,
  validateWebhookUrl,
  type PartnerEnvironment,
  type PartnerScope,
} from "./domain";

/**
 * Partner registry, API keys and webhook endpoints (Stage 12b). Ops admins
 * manage them; keys and webhook URLs need a second ops admin (user decision),
 * revocation and suspension apply at once. Every change is audited.
 */

export class PartnerError extends Error {
  constructor(
    readonly code: "invalid" | "not_found" | "self_approval" | "not_pending" | "expired" | "wrong_state" | "conflict",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PartnerError";
  }
}

type Actor = { staffId: string; now?: Date };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function audit(
  db: DbExecutor,
  staffId: string,
  eventType: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  await recordAuditEvent(db, { actorType: "user", actorId: staffId, eventType, entityType, entityId, metadata });
}

const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
function uniqueViolation(e: unknown): boolean {
  if (isUniqueViolation(e)) return true;
  const cause = (e as { cause?: unknown } | null)?.cause;
  return cause ? isUniqueViolation(cause) : false;
}

// ── Partners ────────────────────────────────────────────────────────────────

/**
 * A partner is bound to an existing partner-API lender config whose mode
 * matches its environment (so a partner key can never read the simulated
 * lender's proposals, or a sandbox partner receive live ones). In production
 * only live partners can be added.
 */
export async function createPartner(
  db: Database,
  input: Actor & { key: string; name: string; environment: string; lenderKey: string; production?: boolean },
) {
  const key = input.key.trim();
  const lenderKey = input.lenderKey.trim();
  const name = input.name.trim();
  if (!PARTNER_KEY_PATTERN.test(key))
    throw new PartnerError("invalid", "Use a short key: lowercase letters, digits, _.");
  if (!PARTNER_KEY_PATTERN.test(lenderKey))
    throw new PartnerError("invalid", "Enter the lender config key this partner serves (e.g. partner_sandbox).");
  if (name.length < 2 || name.length > 80)
    throw new PartnerError("invalid", "Give the partner a name (2–80 characters).");
  if (!(PARTNER_ENVIRONMENTS as readonly string[]).includes(input.environment))
    throw new PartnerError("invalid", "Choose sandbox or live.");
  if (input.production && input.environment !== "live")
    throw new PartnerError("invalid", "Only live partners can be added in production.");
  try {
    return await db.transaction(async (tx) => {
      const [config] = await tx
        .select({ adapter: providerConfigs.adapter, mode: providerConfigs.mode })
        .from(providerConfigs)
        .where(and(eq(providerConfigs.kind, "lender"), eq(providerConfigs.key, lenderKey)));
      if (!config || config.adapter !== "partner_api")
        throw new PartnerError(
          "invalid",
          "Create a partner-API lender config with this key first (Integrations → Partner lender).",
        );
      if (config.mode !== input.environment)
        throw new PartnerError(
          "invalid",
          `That lender config runs in ${config.mode} mode — it must match the partner's environment.`,
        );
      const [row] = await tx
        .insert(partners)
        .values({
          key,
          name,
          environment: input.environment as PartnerEnvironment,
          lenderKey,
          createdBy: input.staffId,
        })
        .returning();
      await audit(tx, input.staffId, "partners.partner_created", "partner", row!.id, {
        environment: row!.environment,
      });
      return row!;
    });
  } catch (error) {
    if (uniqueViolation(error))
      throw new PartnerError("conflict", "A partner with that key, or for that lender config, already exists.");
    throw error;
  }
}

/** Suspension blocks every API key and pauses webhook delivery at once. */
export async function setPartnerStatus(
  db: Database,
  input: Actor & { partnerId: string; status: "active" | "suspended"; reason: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new PartnerError("invalid", "Give a reason (3–500 characters).");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(partners)
      .set({ status: input.status })
      .where(eq(partners.id, input.partnerId))
      .returning();
    if (!row) throw new PartnerError("not_found");
    await audit(
      tx,
      input.staffId,
      input.status === "suspended" ? "partners.partner_suspended" : "partners.partner_reactivated",
      "partner",
      row.id,
    );
    return row;
  });
}

/** Locks the partner row (serialises endpoint changes with event recording). */
async function activePartner(db: DbExecutor, partnerId: string) {
  const [p] = await db.select().from(partners).where(eq(partners.id, partnerId)).for("update");
  if (!p) throw new PartnerError("not_found");
  if (p.status !== "active") throw new PartnerError("wrong_state", "The partner is suspended.");
  return p;
}

// ── API keys ────────────────────────────────────────────────────────────────

export interface ProposeKeyInput extends Actor {
  partnerId: string;
  label: string;
  scopes: string[];
  lifetimeDays?: number;
  replacesKeyId?: string | null;
  overlapHours?: number | null;
}

/**
 * Issues a key that works only after a different ops admin approves it. The
 * key is returned here, once, for the issuer to hand to the partner; only its
 * hash is stored.
 */
export async function proposeApiKey(db: Database, input: ProposeKeyInput): Promise<{ id: string; key: string }> {
  const now = input.now ?? new Date();
  const label = input.label.trim();
  if (label.length < 2 || label.length > 80) throw new PartnerError("invalid", "Label the key (2–80 characters).");
  const scopes = [...new Set(input.scopes)];
  if (!scopes.length || scopes.some((s) => !(PARTNER_SCOPES as readonly string[]).includes(s)))
    throw new PartnerError("invalid", "Choose at least one scope.");
  const lifetime = input.lifetimeDays ?? DEFAULT_KEY_LIFETIME_DAYS;
  if (!(KEY_LIFETIME_DAYS as readonly number[]).includes(lifetime))
    throw new PartnerError("invalid", "Choose a lifetime.");
  const overlap = input.replacesKeyId ? (input.overlapHours ?? 24) : null;
  if (overlap !== null && !(ROTATION_OVERLAP_HOURS as readonly number[]).includes(overlap))
    throw new PartnerError("invalid", "Choose an overlap window.");

  return db.transaction(async (tx) => {
    const partner = await activePartner(tx, input.partnerId);
    if (input.replacesKeyId) {
      const [old] = await tx
        .select({ id: partnerApiKeys.id, status: partnerApiKeys.status })
        .from(partnerApiKeys)
        .where(and(eq(partnerApiKeys.id, input.replacesKeyId), eq(partnerApiKeys.partnerId, partner.id)));
      if (!old || old.status !== "active") throw new PartnerError("invalid", "Only an active key can be rotated.");
    }
    const generated = generateApiKey(partner.environment);
    const [row] = await tx
      .insert(partnerApiKeys)
      .values({
        partnerId: partner.id,
        prefix: generated.prefix,
        secretHash: generated.hash,
        label,
        scopes: scopes as PartnerScope[],
        status: "pending",
        expiresAt: new Date(now.getTime() + lifetime * DAY),
        replacesKeyId: input.replacesKeyId ?? null,
        overlapHours: overlap,
        proposedBy: input.staffId,
        proposedAt: now,
      })
      .returning({ id: partnerApiKeys.id, prefix: partnerApiKeys.prefix });
    await audit(tx, input.staffId, "partners.key_proposed", "partner_api_key", row!.id, {
      partner: partner.key,
      prefix: row!.prefix,
      scopes: scopes.length,
      rotation: Boolean(input.replacesKeyId),
    });
    return { id: row!.id, key: generated.key };
  });
}

export async function decideApiKey(db: Database, input: Actor & { keyId: string; approve: boolean }) {
  const now = input.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const [k] = await tx.select().from(partnerApiKeys).where(eq(partnerApiKeys.id, input.keyId)).for("update");
    if (!k) throw new PartnerError("not_found");
    if (k.status !== "pending") throw new PartnerError("not_pending", "This key was already decided.");
    if (k.proposedBy === input.staffId)
      throw new PartnerError("self_approval", "A different ops admin has to approve or reject this key.");
    if (pendingExpired(k.proposedAt, now)) {
      await tx.update(partnerApiKeys).set({ status: "expired" }).where(eq(partnerApiKeys.id, k.id));
      return { expired: true as const };
    }
    if (input.approve) await activePartner(tx, k.partnerId);
    const [row] = await tx
      .update(partnerApiKeys)
      .set({ status: input.approve ? "active" : "rejected", decidedBy: input.staffId, decidedAt: now })
      .where(eq(partnerApiKeys.id, k.id))
      .returning();
    if (input.approve && k.replacesKeyId) {
      // The replaced key keeps working for the overlap window, then expires.
      await tx
        .update(partnerApiKeys)
        .set({
          expiresAt: sql`least(${partnerApiKeys.expiresAt}, ${new Date(now.getTime() + (k.overlapHours ?? 0) * HOUR).toISOString()}::timestamptz)`,
        })
        .where(and(eq(partnerApiKeys.id, k.replacesKeyId), eq(partnerApiKeys.status, "active")));
    }
    await audit(
      tx,
      input.staffId,
      input.approve ? "partners.key_approved" : "partners.key_rejected",
      "partner_api_key",
      k.id,
      { prefix: k.prefix },
    );
    return { row: row! };
  });
  if ("expired" in result) throw new PartnerError("expired", "This key waited too long for approval. Issue a new one.");
  return result.row;
}

/** Any ops admin, at once. */
export async function revokeApiKey(db: Database, input: Actor & { keyId: string; reason: string }) {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new PartnerError("invalid", "Give a reason (3–500 characters).");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(partnerApiKeys)
      .set({ status: "revoked", revokedBy: input.staffId, revokedAt: now, revokeReason: reason })
      .where(and(eq(partnerApiKeys.id, input.keyId), eq(partnerApiKeys.status, "active")))
      .returning();
    if (!row) throw new PartnerError("wrong_state", "Only an active key can be revoked.");
    await audit(tx, input.staffId, "partners.key_revoked", "partner_api_key", row.id, { prefix: row.prefix });
    return row;
  });
}

/** The issuer withdraws a key before it's approved (they hold the raw key). */
export async function cancelApiKey(db: Database, input: Actor & { keyId: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(partnerApiKeys)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(partnerApiKeys.id, input.keyId),
          eq(partnerApiKeys.status, "pending"),
          eq(partnerApiKeys.proposedBy, input.staffId),
        ),
      )
      .returning();
    if (!row) throw new PartnerError("wrong_state", "Only your own key awaiting approval can be cancelled.");
    await audit(tx, input.staffId, "partners.key_cancelled", "partner_api_key", row.id, { prefix: row.prefix });
    return row;
  });
}

export interface AuthenticatedPartner {
  keyId: string;
  keyPrefix: string;
  scopes: readonly PartnerScope[];
  partner: { id: string; key: string; name: string; environment: PartnerEnvironment; lenderKey: string };
}

/** Resolves a bearer API key. Null for anything not currently usable (no reason is given to the caller). */
export async function authenticateApiKey(
  db: DbExecutor,
  raw: string,
  now = new Date(),
): Promise<AuthenticatedPartner | null> {
  const parsed = parseApiKey(raw);
  if (!parsed) return null;
  const [row] = await db
    .select({ key: partnerApiKeys, partner: partners, adapter: providerConfigs.adapter, mode: providerConfigs.mode })
    .from(partnerApiKeys)
    .innerJoin(partners, eq(partners.id, partnerApiKeys.partnerId))
    .leftJoin(providerConfigs, and(eq(providerConfigs.kind, "lender"), eq(providerConfigs.key, partners.lenderKey)))
    .where(eq(partnerApiKeys.prefix, parsed.prefix))
    .limit(1);
  if (!row || !apiKeyMatches(raw, row.key.secretHash)) return null;
  if (parsed.environment !== row.partner.environment || !keyIsUsable(row.key, row.partner, now)) return null;
  // The binding is checked on every call: if the lender config stops being a partner-API config in the
  // partner's environment, its keys stop working.
  if (row.adapter !== "partner_api" || row.mode !== row.partner.environment) return null;
  if (!row.key.lastUsedAt || now.getTime() - row.key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.update(partnerApiKeys).set({ lastUsedAt: now }).where(eq(partnerApiKeys.id, row.key.id));
  }
  return {
    keyId: row.key.id,
    keyPrefix: row.key.prefix,
    scopes: row.key.scopes,
    partner: {
      id: row.partner.id,
      key: row.partner.key,
      name: row.partner.name,
      environment: row.partner.environment,
      lenderKey: row.partner.lenderKey,
    },
  };
}

// ── Webhook endpoints ───────────────────────────────────────────────────────

/** Proposes a webhook URL (a second ops admin approves). Returns its signing secret, once. */
export async function proposeWebhookEndpoint(
  db: Database,
  input: Actor & { partnerId: string; url: string; production: boolean },
): Promise<{ id: string; secret: string }> {
  const now = input.now ?? new Date();
  const problem = validateWebhookUrl(input.url, { production: input.production });
  if (problem) throw new PartnerError("invalid", problem);
  const url = new URL(input.url.trim()).toString();
  try {
    return await db.transaction(async (tx) => {
      const partner = await activePartner(tx, input.partnerId);
      if (partner.environment === "live" && !url.startsWith("https://"))
        throw new PartnerError("invalid", "A live partner's webhook URL must use HTTPS.");
      const [row] = await tx
        .insert(partnerWebhookEndpoints)
        .values({ partnerId: partner.id, url, status: "pending", proposedBy: input.staffId, proposedAt: now })
        .returning({ id: partnerWebhookEndpoints.id });
      await audit(tx, input.staffId, "partners.webhook_proposed", "partner_webhook_endpoint", row!.id, {
        partner: partner.key,
        host: new URL(url).host,
      });
      return { id: row!.id, secret: deriveWebhookSecret(row!.id, 1) };
    });
  } catch (error) {
    if (uniqueViolation(error))
      throw new PartnerError("conflict", "Another webhook URL for this partner is already waiting for approval.");
    throw error;
  }
}

/** Stops deliveries to an endpoint that is no longer current (the events stay in the partner's feed). */
async function closeDeliveries(tx: DbExecutor, endpointId: string) {
  return tx
    .update(partnerWebhookDeliveries)
    .set({ status: "dead", lastError: "endpoint_retired", nextAttemptAt: null })
    .where(and(eq(partnerWebhookDeliveries.endpointId, endpointId), eq(partnerWebhookDeliveries.status, "pending")))
    .returning({ eventId: partnerWebhookDeliveries.eventId });
}

export async function decideWebhookEndpoint(db: Database, input: Actor & { endpointId: string; approve: boolean }) {
  const now = input.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const [e] = await tx
      .select()
      .from(partnerWebhookEndpoints)
      .where(eq(partnerWebhookEndpoints.id, input.endpointId))
      .limit(1);
    if (!e) throw new PartnerError("not_found");
    // Partner first, then the endpoint: the same lock order as event recording, so no delivery can be
    // queued for an endpoint while it's being replaced.
    await tx.select({ id: partners.id }).from(partners).where(eq(partners.id, e.partnerId)).for("update");
    await tx
      .select({ id: partnerWebhookEndpoints.id })
      .from(partnerWebhookEndpoints)
      .where(eq(partnerWebhookEndpoints.id, e.id))
      .for("update");
    const [fresh] = await tx.select().from(partnerWebhookEndpoints).where(eq(partnerWebhookEndpoints.id, e.id));
    if (fresh!.status !== "pending") throw new PartnerError("not_pending", "This URL was already decided.");
    if (e.proposedBy === input.staffId)
      throw new PartnerError("self_approval", "A different ops admin has to approve or reject this URL.");
    if (pendingExpired(e.proposedAt, now)) {
      await tx.update(partnerWebhookEndpoints).set({ status: "expired" }).where(eq(partnerWebhookEndpoints.id, e.id));
      return { expired: true as const };
    }
    if (input.approve) {
      await activePartner(tx, e.partnerId);
      const [current] = await tx
        .update(partnerWebhookEndpoints)
        .set({ status: "retired", retiredAt: now })
        .where(and(eq(partnerWebhookEndpoints.partnerId, e.partnerId), eq(partnerWebhookEndpoints.status, "active")))
        .returning({ id: partnerWebhookEndpoints.id });
      const [row] = await tx
        .update(partnerWebhookEndpoints)
        .set({ status: "active", decidedBy: input.staffId, decidedAt: now })
        .where(eq(partnerWebhookEndpoints.id, e.id))
        .returning();
      // Undelivered events move to the new URL.
      if (current) {
        const moved = await closeDeliveries(tx, current.id);
        if (moved.length) {
          await tx
            .insert(partnerWebhookDeliveries)
            .values(moved.map((m) => ({ eventId: m.eventId, endpointId: e.id })))
            .onConflictDoNothing();
        }
      }
      await audit(tx, input.staffId, "partners.webhook_approved", "partner_webhook_endpoint", e.id);
      return { row: row! };
    }
    const [row] = await tx
      .update(partnerWebhookEndpoints)
      .set({ status: "rejected", decidedBy: input.staffId, decidedAt: now })
      .where(eq(partnerWebhookEndpoints.id, e.id))
      .returning();
    await audit(tx, input.staffId, "partners.webhook_rejected", "partner_webhook_endpoint", e.id);
    return { row: row! };
  });
  if ("expired" in result)
    throw new PartnerError("expired", "This URL waited too long for approval. Propose it again.");
  return result.row;
}

/** Any ops admin, at once: stops all deliveries (e.g. the partner's receiver is compromised). */
export async function retireWebhookEndpoint(db: Database, input: Actor & { endpointId: string }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ partnerId: partnerWebhookEndpoints.partnerId })
      .from(partnerWebhookEndpoints)
      .where(eq(partnerWebhookEndpoints.id, input.endpointId));
    if (target)
      await tx.select({ id: partners.id }).from(partners).where(eq(partners.id, target.partnerId)).for("update");
    const [row] = await tx
      .update(partnerWebhookEndpoints)
      .set({ status: "retired", retiredAt: now })
      .where(and(eq(partnerWebhookEndpoints.id, input.endpointId), eq(partnerWebhookEndpoints.status, "active")))
      .returning();
    if (!row) throw new PartnerError("wrong_state", "Only the active URL can be retired.");
    await closeDeliveries(tx, row.id);
    await audit(tx, input.staffId, "partners.webhook_retired", "partner_webhook_endpoint", row.id);
    return row;
  });
}

/** The proposer withdraws a URL before it's approved. */
export async function cancelWebhookEndpoint(db: Database, input: Actor & { endpointId: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(partnerWebhookEndpoints)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(partnerWebhookEndpoints.id, input.endpointId),
          eq(partnerWebhookEndpoints.status, "pending"),
          eq(partnerWebhookEndpoints.proposedBy, input.staffId),
        ),
      )
      .returning();
    if (!row) throw new PartnerError("wrong_state", "Only your own URL awaiting approval can be cancelled.");
    await audit(tx, input.staffId, "partners.webhook_cancelled", "partner_webhook_endpoint", row.id);
    return row;
  });
}

/**
 * New signing secret for the active endpoint (any ops admin). The previous
 * secret is still sent alongside for WEBHOOK_SECRET_OVERLAP_HOURS, so the
 * partner can switch without missing events. Returns the new secret, once.
 */
export async function rotateWebhookSecret(db: Database, input: Actor & { endpointId: string }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [e] = await tx
      .select()
      .from(partnerWebhookEndpoints)
      .where(eq(partnerWebhookEndpoints.id, input.endpointId))
      .for("update");
    if (!e || e.status !== "active")
      throw new PartnerError("wrong_state", "Only the active URL's secret can be rotated.");
    const version = e.secretVersion + 1;
    await tx
      .update(partnerWebhookEndpoints)
      .set({
        secretVersion: version,
        previousSecretVersion: e.secretVersion,
        previousSecretUntil: new Date(now.getTime() + WEBHOOK_SECRET_OVERLAP_HOURS * HOUR),
      })
      .where(eq(partnerWebhookEndpoints.id, e.id));
    await audit(tx, input.staffId, "partners.webhook_secret_rotated", "partner_webhook_endpoint", e.id, { version });
    return { id: e.id, version, secret: deriveWebhookSecret(e.id, version) };
  });
}

/** The secrets a delivery is signed with right now (current, plus the previous one during the overlap). */
export function signingSecretsFor(
  e: { id: string; secretVersion: number; previousSecretVersion: number | null; previousSecretUntil: Date | null },
  now: Date,
): string[] {
  const secrets = [deriveWebhookSecret(e.id, e.secretVersion)];
  if (e.previousSecretVersion !== null && e.previousSecretUntil && e.previousSecretUntil.getTime() > now.getTime())
    secrets.push(deriveWebhookSecret(e.id, e.previousSecretVersion));
  return secrets;
}

// ── Read models (/ops) ──────────────────────────────────────────────────────

export async function listPartners(db: DbExecutor) {
  const rows = await db.select().from(partners).orderBy(partners.name);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const keys = await db
    .select({ partnerId: partnerApiKeys.partnerId, status: partnerApiKeys.status, n: sql<number>`count(*)::int` })
    .from(partnerApiKeys)
    .where(inArray(partnerApiKeys.partnerId, ids))
    .groupBy(partnerApiKeys.partnerId, partnerApiKeys.status);
  const endpoints = await db
    .select({ partnerId: partnerWebhookEndpoints.partnerId, status: partnerWebhookEndpoints.status })
    .from(partnerWebhookEndpoints)
    .where(
      and(
        inArray(partnerWebhookEndpoints.partnerId, ids),
        inArray(partnerWebhookEndpoints.status, ["active", "pending"]),
      ),
    );
  return rows.map((p) => ({
    ...p,
    activeKeys: keys.find((k) => k.partnerId === p.id && k.status === "active")?.n ?? 0,
    pendingKeys: keys.find((k) => k.partnerId === p.id && k.status === "pending")?.n ?? 0,
    webhook: endpoints.some((e) => e.partnerId === p.id && e.status === "active")
      ? ("active" as const)
      : endpoints.some((e) => e.partnerId === p.id)
        ? ("pending" as const)
        : ("none" as const),
  }));
}

export async function getPartnerDetail(db: DbExecutor, partnerId: string) {
  const [partner] = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
  if (!partner) return null;
  const emails = new Map<string, string>();
  const keys = await db
    .select()
    .from(partnerApiKeys)
    .where(eq(partnerApiKeys.partnerId, partnerId))
    .orderBy(desc(partnerApiKeys.createdAt));
  const endpoints = await db
    .select()
    .from(partnerWebhookEndpoints)
    .where(eq(partnerWebhookEndpoints.partnerId, partnerId))
    .orderBy(desc(partnerWebhookEndpoints.createdAt));
  const deliveries = await db
    .select({
      id: partnerWebhookDeliveries.id,
      status: partnerWebhookDeliveries.status,
      attempts: partnerWebhookDeliveries.attempts,
      lastHttpStatus: partnerWebhookDeliveries.lastHttpStatus,
      lastError: partnerWebhookDeliveries.lastError,
      lastAttemptAt: partnerWebhookDeliveries.lastAttemptAt,
      nextAttemptAt: partnerWebhookDeliveries.nextAttemptAt,
      deliveredAt: partnerWebhookDeliveries.deliveredAt,
      endpointId: partnerWebhookDeliveries.endpointId,
      eventType: partnerEvents.type,
      eventId: partnerEvents.id,
      eventSeq: partnerEvents.seq,
      createdAt: partnerEvents.createdAt,
    })
    .from(partnerWebhookDeliveries)
    .innerJoin(partnerEvents, eq(partnerEvents.id, partnerWebhookDeliveries.eventId))
    .where(eq(partnerEvents.partnerId, partnerId))
    .orderBy(desc(partnerEvents.seq))
    .limit(25);
  const staffIds = [
    ...new Set(
      [
        ...keys.flatMap((k) => [k.proposedBy, k.decidedBy, k.revokedBy]),
        ...endpoints.flatMap((e) => [e.proposedBy, e.decidedBy]),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
  if (staffIds.length) {
    for (const u of await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, staffIds)))
      emails.set(u.id, u.email);
  }
  const who = (id: string | null) => (id ? (emails.get(id) ?? "staff") : null);
  return {
    partner,
    keys: keys.map(({ secretHash: _hash, ...k }) => ({
      ...k,
      proposedByEmail: who(k.proposedBy),
      decidedByEmail: who(k.decidedBy),
      revokedByEmail: who(k.revokedBy),
    })),
    endpoints: endpoints.map((e) => ({ ...e, proposedByEmail: who(e.proposedBy), decidedByEmail: who(e.decidedBy) })),
    deliveries,
  };
}

/** Keys and webhook URLs waiting for a second ops admin (for /ops/changes). */
export async function pendingPartnerApprovals(db: DbExecutor) {
  const keys = await db
    .select({
      id: partnerApiKeys.id,
      partnerId: partnerApiKeys.partnerId,
      label: partnerApiKeys.label,
      prefix: partnerApiKeys.prefix,
      proposedBy: partnerApiKeys.proposedBy,
      proposedAt: partnerApiKeys.proposedAt,
      partner: partners.name,
    })
    .from(partnerApiKeys)
    .innerJoin(partners, eq(partners.id, partnerApiKeys.partnerId))
    .where(eq(partnerApiKeys.status, "pending"));
  const endpoints = await db
    .select({
      id: partnerWebhookEndpoints.id,
      partnerId: partnerWebhookEndpoints.partnerId,
      url: partnerWebhookEndpoints.url,
      proposedBy: partnerWebhookEndpoints.proposedBy,
      proposedAt: partnerWebhookEndpoints.proposedAt,
      partner: partners.name,
    })
    .from(partnerWebhookEndpoints)
    .innerJoin(partners, eq(partners.id, partnerWebhookEndpoints.partnerId))
    .where(eq(partnerWebhookEndpoints.status, "pending"));
  return { keys, endpoints };
}
