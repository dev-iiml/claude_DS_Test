import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDbOptions {
  url: string;
  /** Max pool size. Keep small on serverless. */
  max?: number;
  /** Disable prepared statements behind transaction poolers (e.g. PgBouncer). */
  prepare?: boolean;
}

/**
 * Creates a Drizzle client. Framework-agnostic so scripts and tests can use it;
 * the app uses the `server-only` singleton in `./index.ts`.
 *
 * Query logging is intentionally off: parameters can contain personal data.
 */
export function createDb({ url, max = 5, prepare = true }: CreateDbOptions) {
  const client = postgres(url, {
    max,
    prepare,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const db: Database = drizzle(client, { schema, logger: false });
  return { db, client };
}
