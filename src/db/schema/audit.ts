import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { ACTOR_TYPES } from "@/modules/audit/domain";

import { createdAt, sqlInList } from "./_shared";

/**
 * Append-only audit trail (UPDATE/DELETE blocked by trigger).
 * Metadata is restricted to small, non-sensitive scalars: the application
 * sanitiser rejects sensitive keys and the CHECK caps size.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: text("actor_type", { enum: ACTOR_TYPES }).notNull(),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc()),
    index("audit_events_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("audit_events_event_type_idx").on(t.eventType, t.createdAt.desc()),
    check("audit_events_actor_type_valid", sql`${t.actorType} in (${sqlInList(ACTOR_TYPES)})`),
    check("audit_events_event_type_format", sql`${t.eventType} ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'`),
    check("audit_events_entity_type_format", sql`${t.entityType} ~ '^[a-z][a-z_]*$'`),
    check(
      "audit_events_metadata_bounded",
      sql`jsonb_typeof(${t.metadata}) = 'object' and pg_column_size(${t.metadata}) <= 2048`,
    ),
  ],
).enableRLS();
