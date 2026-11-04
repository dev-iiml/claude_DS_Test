import { createDb } from "../create-db";
import { seedDemoData } from "../seed/demo";
import { publishReferenceData } from "../seed/reference";

import { assertNotProduction, describeUrl, requireDatabaseUrl, strongStagingPassword } from "./_env";

/**
 * `npm run db:reference` → reference data only (safe in every environment).
 * `npm run db:seed`      → reference data + fictional demo users (dev/test only).
 * `npm run db:seed -- --staging-demo` → the same fictional demo on STAGING (Stage 17), only with a strong,
 *   non-default SEED_DEMO_PASSWORD, since staging is reachable from the internet. Never production.
 */
async function main() {
  const referenceOnly = process.argv.includes("--reference-only");
  // Hosted environments seed through the migration connection; the app's own URL lives only in its runtime secret.
  const url = process.env.DATABASE_MIGRATION_URL || requireDatabaseUrl();
  const { db, client } = createDb({ url, max: 1 });
  try {
    await publishReferenceData(db);
    console.log("✓ reference data published");
    if (referenceOnly) return;

    const password = process.env.SEED_DEMO_PASSWORD;
    const stagingDemo = process.argv.includes("--staging-demo") && process.env.APP_ENV === "staging";
    if (stagingDemo) {
      if (!password || !strongStagingPassword(password))
        throw new Error("staging demo needs a strong SEED_DEMO_PASSWORD (20+ characters, not the default)");
    } else {
      assertNotProduction("demo seed");
    }
    if (!password || password.length < 12) throw new Error("SEED_DEMO_PASSWORD must be set (12+ characters)");
    const { createdProfiles } = await seedDemoData(db, password);
    console.log(`✓ demo seed applied to ${describeUrl(url)} (${createdProfiles} new creator profiles)`);
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("✗ seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
