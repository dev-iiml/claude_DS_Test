import { createDb } from "../src/db/create-db";
import { runMigrations } from "../src/db/scripts/migrate";
import { recreateDatabase } from "../src/db/scripts/reset";
import { seedDemoData } from "../src/db/seed/demo";
import { publishReferenceData } from "../src/db/seed/reference";

/** Recreates the E2E database from migrations and loads the deterministic seed. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !/_e2e$/.test(new URL(url).pathname)) throw new Error("E2E database name must end with _e2e");
  await recreateDatabase(url);
  await runMigrations(url);
  const { db, client } = createDb({ url, max: 1 });
  await publishReferenceData(db);
  await seedDemoData(db, process.env.SEED_DEMO_PASSWORD ?? "CreatorCo-demo-2026");
  await client.end();
  console.log("✓ e2e database ready");
}

main().catch((e: unknown) => {
  console.error("✗ e2e database setup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
