import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "../create-db";
import { publishReferenceData } from "../seed/reference";

import { describeUrl, requireDatabaseUrl } from "./_env";

export async function runMigrations(url: string) {
  const { db, client } = createDb({ url, max: 1 });
  try {
    await migrate(db, { migrationsFolder: "src/db/migrations", migrationsSchema: "drizzle" });
    // Least-privilege app role (Stage 16): cover tables added by any migration (no-op until the role exists).
    await db.execute(sql`select public.grant_app_access()`);
  } finally {
    await client.end();
  }
}

/**
 * Consent texts are reference data the app cannot run without (e.g. a new
 * purpose added in a stage). Publishing is idempotent and never edits a
 * published version, so `db:migrate` always does it too.
 */
async function migrateAndPublish(url: string) {
  await runMigrations(url);
  const { db, client } = createDb({ url, max: 1 });
  try {
    await publishReferenceData(db);
  } finally {
    await client.end();
  }
}

// pathToFileURL percent-encodes the path (e.g. spaces), matching import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Migrations run as the schema owner; the app itself connects with a least-privilege user (Stage 16).
  const url = process.env.DATABASE_MIGRATION_URL || requireDatabaseUrl();
  migrateAndPublish(url)
    .then(() => console.log(`✓ migrations and reference data applied to ${describeUrl(url)}`))
    .catch((e: unknown) => {
      console.error(
        "✗ migration failed:",
        e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : e,
      );
      process.exit(1);
    });
}
