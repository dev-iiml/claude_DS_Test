import { config } from "dotenv";
import { afterAll } from "vitest";

import { createDb } from "@/db/create-db";
import type { AuthDeps } from "@/modules/identity/auth/auth-service";

config({ path: [".env.local", ".env"], quiet: true });

/** Opens a pool to the integration database and closes it after the file's tests. */
export function connectTestDb() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set");
  const { db, client } = createDb({ url, max: 3 });
  afterAll(async () => {
    await client.end();
  });
  return { db, client };
}

let counter = 0;
/** Unique, obviously fictional email per test. */
export function testEmail(label = "creator") {
  counter += 1;
  return `${label}.${Date.now().toString(36)}.${counter}@tests.creatorco.test`;
}

export function authDepsFor(db: AuthDeps["db"], now?: () => Date): AuthDeps {
  return { db, sessionTtlHours: 24, now };
}
