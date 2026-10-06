import { createDb } from "../create-db";
import { seedDemoData } from "../seed/demo";
import { publishReferenceData } from "../seed/reference";

import { assertNotProduction, describeUrl, requireDatabaseUrl } from "./_env";

/**
 * `npm run db:reference` → reference data only (safe in every environment).
 * `npm run db:seed`      → reference data + fictional demo users (dev/test only).
 */
async function main() {
  const referenceOnly = process.argv.includes("--reference-only");
  const url = requireDatabaseUrl();
  const { db, client } = createDb({ url, max: 1 });
  try {
    await publishReferenceData(db);
    console.log("✓ reference data published");
    if (referenceOnly) return;

    assertNotProduction("demo seed");
    const password = process.env.SEED_DEMO_PASSWORD;
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
