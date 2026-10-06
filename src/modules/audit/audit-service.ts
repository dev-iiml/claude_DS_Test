import { auditEvents } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

import type { ActorType } from "./domain";
import { sanitiseAuditMetadata } from "./sanitise";

export interface AuditEventInput {
  actorType: ActorType;
  actorId?: string | null;
  /** Dotted, lower-case: `<domain>.<action>` e.g. `consent.granted`. */
  eventType: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends an audit event. Pass the transaction handle when the event must be
 * atomic with the change it describes.
 */
export async function recordAuditEvent(db: DbExecutor, event: AuditEventInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    metadata: sanitiseAuditMetadata(event.metadata),
  });
}
