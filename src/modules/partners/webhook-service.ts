import { lookup } from "node:dns/promises";

import { and, asc, eq, gt, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { partnerEvents, partnerWebhookDeliveries, partnerWebhookEndpoints, partners } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import { signatureHeader } from "./credentials";
import {
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  WEBHOOK_TIMEOUT_MS,
  deliveryRetryDelayMs,
  eventEnvelope,
  isNonPublicAddress,
  type PartnerEventEnvelope,
  type PartnerEventType,
} from "./domain";
import { PartnerError, signingSecretsFor } from "./partner-service";

/**
 * Thin partner events (Stage 12b): an outbox written in the same transaction
 * as the change it announces, delivered as HMAC-signed webhooks with retries,
 * and readable as a feed so a partner can recover anything it missed.
 * Webhook bodies carry identifiers only; request and response bodies are
 * never stored or logged.
 */

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
/** Resolves with the HTTP status; rejects on network failure or timeout. */
export type WebhookTransport = (request: WebhookRequest) => Promise<{ status: number }>;

export class WebhookTimeoutError extends Error {}
export class WebhookBlockedError extends Error {}

/**
 * HTTP transport for webhooks. Redirects are never followed and response
 * bodies never read. Production-like environments resolve the host first and
 * refuse non-public addresses (SSRF guard; an egress proxy that pins the
 * resolved address is the stronger control — see docs/API.md).
 */
export function createFetchTransport(opts: { guardAddresses: boolean }): WebhookTransport {
  return async (req) => {
    if (opts.guardAddresses) {
      const host = new URL(req.url).hostname.replace(/\.+$/, "");
      let addresses: { address: string }[];
      try {
        addresses = await lookup(host, { all: true, verbatim: true });
      } catch {
        throw new WebhookBlockedError("dns");
      }
      if (!addresses.length || addresses.some((a) => isNonPublicAddress(a.address)))
        throw new WebhookBlockedError("blocked_address");
    }
    try {
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        redirect: "manual", // a redirect is a failed delivery, never followed
        signal: AbortSignal.timeout(req.timeoutMs),
        cache: "no-store",
      });
      await res.body?.cancel().catch(() => undefined); // the response body is never read
      return { status: res.status };
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
        throw new WebhookTimeoutError("timeout");
      throw error;
    }
  };
}

const productionLike = () => process.env.APP_ENV === "staging" || process.env.APP_ENV === "production";

/**
 * Records an event for the partner serving `lenderKey` (or `partnerId`) and
 * queues a delivery to its active webhook URL. Null when no partner is
 * registered for that lender (e.g. the simulated lender). Call inside the
 * transaction that makes the change.
 */
export async function recordPartnerEvent(
  tx: DbExecutor,
  input: {
    lenderKey?: string;
    partnerId?: string;
    type: PartnerEventType;
    proposalId?: string | null;
    queryId?: string | null;
    now?: Date;
  },
) {
  // Locks the partner row until the caller commits: event inserts for one partner are serialised, so the
  // feed's `seq` order is commit order (a cursor never skips a late-committing event), and no endpoint can be
  // replaced or retired between reading it here and queuing the delivery.
  const [partner] = await tx
    .select({ id: partners.id })
    .from(partners)
    .where(input.partnerId ? eq(partners.id, input.partnerId) : eq(partners.lenderKey, input.lenderKey ?? ""))
    .for("update");
  if (!partner) return null;
  const [event] = await tx
    .insert(partnerEvents)
    .values({
      partnerId: partner.id,
      type: input.type,
      proposalId: input.proposalId ?? null,
      queryId: input.queryId ?? null,
      ...(input.now ? { createdAt: input.now } : {}),
    })
    .returning();
  const [endpoint] = await tx
    .select({ id: partnerWebhookEndpoints.id })
    .from(partnerWebhookEndpoints)
    .where(and(eq(partnerWebhookEndpoints.partnerId, partner.id), eq(partnerWebhookEndpoints.status, "active")))
    .limit(1);
  if (endpoint) await tx.insert(partnerWebhookDeliveries).values({ eventId: event!.id, endpointId: endpoint.id });
  return event!;
}

export async function sendTestPing(db: Database, input: { staffId: string; partnerId: string; now?: Date }) {
  return db.transaction(async (tx) => {
    const event = await recordPartnerEvent(tx, { partnerId: input.partnerId, type: "ping", now: input.now });
    if (!event) throw new PartnerError("not_found");
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "partners.webhook_ping",
      entityType: "partner",
      entityId: input.partnerId,
      metadata: {},
    });
    return event;
  });
}

export interface DeliveryDeps {
  db: Database;
  now?: Date;
  transport?: WebhookTransport;
}

function errorClass(error: unknown): string {
  if (error instanceof WebhookTimeoutError) return "timeout";
  if (error instanceof WebhookBlockedError) return error.message === "dns" ? "dns" : "blocked_address";
  return "network";
}

/**
 * Delivers due webhooks (scheduled every minute, and right after a change).
 * Rows are claimed one at a time with a lease longer than a send can take, and
 * results are written only while the lease is still held — so concurrent
 * workers never send the same delivery twice in parallel. Webhooks are still
 * at-least-once: partners de-duplicate on the event id. Each send is signed
 * with the time it's sent.
 */
export async function deliverPartnerWebhooks(deps: DeliveryDeps, limit = 50) {
  const clock = () => deps.now ?? new Date();
  const db = deps.db;
  const transport = deps.transport ?? createFetchTransport({ guardAddresses: productionLike() });
  const counts = { delivered: 0, retrying: 0, dead: 0 };

  // Deliveries left pending for an endpoint that's no longer active are closed (the feed still has the events).
  await db.execute(sql`
    update ops.partner_webhook_deliveries d
       set status = 'dead', last_error = 'endpoint_retired', next_attempt_at = null
      from ops.partner_webhook_endpoints e
     where e.id = d.endpoint_id and d.status = 'pending' and e.status <> 'active'`);

  for (let i = 0; i < limit; i += 1) {
    const claimedAt = clock();
    const lease = new Date(claimedAt.getTime() + DELIVERY_LEASE_MS);
    const [claimed] = [
      ...(await db.execute<{ id: string }>(sql`
        update ops.partner_webhook_deliveries d
           set next_attempt_at = ${lease.toISOString()}::timestamptz
         where d.id = (
           select d2.id from ops.partner_webhook_deliveries d2
             join ops.partner_webhook_endpoints e on e.id = d2.endpoint_id and e.status = 'active'
             join ops.partners p on p.id = e.partner_id and p.status = 'active'
            where d2.status = 'pending'
              and (d2.next_attempt_at is null or d2.next_attempt_at <= ${claimedAt.toISOString()}::timestamptz)
            order by d2.created_at
            limit 1
            for update of d2 skip locked)
        returning d.id`)),
    ];
    if (!claimed) break;
    const [row] = await db
      .select({ d: partnerWebhookDeliveries, e: partnerWebhookEndpoints, ev: partnerEvents })
      .from(partnerWebhookDeliveries)
      .innerJoin(partnerWebhookEndpoints, eq(partnerWebhookEndpoints.id, partnerWebhookDeliveries.endpointId))
      .innerJoin(partnerEvents, eq(partnerEvents.id, partnerWebhookDeliveries.eventId))
      .where(eq(partnerWebhookDeliveries.id, claimed.id));
    if (!row) continue;
    const { d, e, ev } = row;
    const envelope = eventEnvelope(ev);
    const body = JSON.stringify(envelope);
    const sentAt = clock();
    let status: number | null = null;
    let failure: string | null = null;
    try {
      status = (
        await transport({
          url: e.url,
          body,
          timeoutMs: WEBHOOK_TIMEOUT_MS,
          headers: {
            "content-type": "application/json",
            "user-agent": "CreatorCo-Webhooks/1",
            "creatorco-event-id": envelope.id,
            "creatorco-event-type": envelope.type,
            "creatorco-signature": signatureHeader(
              signingSecretsFor(e, sentAt),
              Math.floor(sentAt.getTime() / 1000),
              body,
            ),
          },
        })
      ).status;
      if (status < 200 || status >= 300) failure = `http_${status}`;
    } catch (error) {
      failure = errorClass(error);
    }
    const doneAt = clock();
    const attempts = d.attempts + 1;
    const stillOurs = and(
      eq(partnerWebhookDeliveries.id, d.id),
      eq(partnerWebhookDeliveries.status, "pending"),
      eq(partnerWebhookDeliveries.nextAttemptAt, lease),
    );
    if (!failure) {
      counts.delivered += 1;
      await db
        .update(partnerWebhookDeliveries)
        .set({
          status: "delivered",
          attempts,
          lastAttemptAt: doneAt,
          lastHttpStatus: status,
          lastError: null,
          deliveredAt: doneAt,
          nextAttemptAt: null,
        })
        .where(stillOurs);
      continue;
    }
    const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
    if (dead) counts.dead += 1;
    else counts.retrying += 1;
    await db
      .update(partnerWebhookDeliveries)
      .set({
        status: dead ? "dead" : "pending",
        attempts,
        lastAttemptAt: doneAt,
        lastHttpStatus: status,
        lastError: failure.slice(0, 40),
        nextAttemptAt: dead ? null : new Date(doneAt.getTime() + deliveryRetryDelayMs(attempts)),
      })
      .where(stillOurs);
  }
  return counts;
}

/** Sends a dead delivery again (to the partner's current URL). */
export async function redeliver(db: Database, input: { staffId: string; deliveryId: string }) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(partnerWebhookDeliveries)
      .where(eq(partnerWebhookDeliveries.id, input.deliveryId))
      .for("update");
    const [event] = locked
      ? await tx
          .select({ partnerId: partnerEvents.partnerId })
          .from(partnerEvents)
          .where(eq(partnerEvents.id, locked.eventId))
      : [];
    const d = locked && event ? { d: locked, partnerId: event.partnerId } : null;
    if (!d || d.d.status !== "dead") throw new PartnerError("wrong_state", "Only a failed delivery can be sent again.");
    const [endpoint] = await tx
      .select({ id: partnerWebhookEndpoints.id })
      .from(partnerWebhookEndpoints)
      .where(and(eq(partnerWebhookEndpoints.partnerId, d.partnerId), eq(partnerWebhookEndpoints.status, "active")));
    if (!endpoint) throw new PartnerError("wrong_state", "The partner has no active webhook URL.");
    await tx
      .insert(partnerWebhookDeliveries)
      .values({ eventId: d.d.eventId, endpointId: endpoint.id })
      .onConflictDoUpdate({
        target: [partnerWebhookDeliveries.eventId, partnerWebhookDeliveries.endpointId],
        set: { status: "pending", attempts: 0, nextAttemptAt: null, lastError: null, deliveredAt: null },
      });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "partners.webhook_redelivered",
      entityType: "partner",
      entityId: d.partnerId,
      metadata: {},
    });
  });
}

export const MAX_FEED_PAGE = 100;

/** The partner's event feed, oldest first after a cursor (`seq`). */
export async function listPartnerEvents(
  db: DbExecutor,
  input: { partnerId: string; after?: number; limit?: number },
): Promise<{ data: (PartnerEventEnvelope & { seq: number })[]; nextAfter: number | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_FEED_PAGE);
  const rows = await db
    .select()
    .from(partnerEvents)
    .where(and(eq(partnerEvents.partnerId, input.partnerId), gt(partnerEvents.seq, input.after ?? 0)))
    .orderBy(asc(partnerEvents.seq))
    .limit(limit);
  const data = rows.map((r) => ({ ...eventEnvelope(r), seq: r.seq }));
  return { data, nextAfter: rows.length ? rows[rows.length - 1]!.seq : (input.after ?? null) };
}
