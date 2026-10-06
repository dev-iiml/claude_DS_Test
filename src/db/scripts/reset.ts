import postgres from "postgres";

import { assertNotProduction, describeUrl, requireDatabaseUrl } from "./_env";

/** Drops and recreates the target database. Development/test only. */
export async function recreateDatabase(url: string) {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error("refusing to reset a database with an unusual name");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertNotProduction("db:reset");
  const url = requireDatabaseUrl();
  recreateDatabase(url)
    .then(() => console.log(`✓ recreated empty database ${describeUrl(url)}`))
    .catch((e: unknown) => {
      console.error("✗ reset failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
