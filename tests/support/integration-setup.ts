import { config } from "dotenv";

import { createDb } from "@/db/create-db";
import { recreateDatabase } from "@/db/scripts/reset";
import { runMigrations } from "@/db/scripts/migrate";
import { publishReferenceData } from "@/db/seed/reference";

/**
 * Integration tests run against a real PostgreSQL database that is dropped and
 * rebuilt from migrations on every run — this doubles as the "migrations run
 * cleanly from an empty database" check.
 */
export default async function setup() {
  config({ path: [".env.local", ".env"], quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST must be set for integration tests (see .env.example)");
  if (url === process.env.DATABASE_URL) throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL");

  await recreateDatabase(url);
  await runMigrations(url);
  const { db, client } = createDb({ url, max: 1 });
  await publishReferenceData(db);
  await client.end();
}
