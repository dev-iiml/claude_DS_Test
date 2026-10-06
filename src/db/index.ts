import "server-only";

import { getServerEnv } from "@/lib/env";

import { createDb, type Database } from "./create-db";

export type { Database } from "./create-db";

const globalForDb = globalThis as unknown as { __creatorcoDb?: Database };

/** Process-wide database client for server code (reused across hot reloads in dev). */
export function getDb(): Database {
  if (!globalForDb.__creatorcoDb) {
    const env = getServerEnv();
    globalForDb.__creatorcoDb = createDb({
      url: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      prepare: env.DATABASE_PREPARE,
    }).db;
  }
  return globalForDb.__creatorcoDb;
}
