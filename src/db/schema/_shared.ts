import { sql } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column helpers. Every timestamp is `timestamptz` and stored in UTC.
 * `updated_at` is maintained by the `set_updated_at()` trigger (see migrations),
 * not by application code, so it cannot drift.
 */
export const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

/** Renders a SQL `IN (...)` list of string literals for CHECK constraints. */
export function sqlInList(values: readonly string[]) {
  return sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", "));
}
