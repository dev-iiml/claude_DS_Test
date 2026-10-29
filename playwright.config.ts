import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: [".env.local", ".env"], quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const E2E_DATABASE_URL = process.env.DATABASE_URL_E2E ?? process.env.DATABASE_URL_TEST?.replace(/_test$/, "_e2e");
if (!E2E_DATABASE_URL) throw new Error("Set DATABASE_URL_E2E (or DATABASE_URL_TEST) for E2E tests");
// Exposed to specs that verify persisted state directly.
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;
// Optional (Stage 16): run the server as the least-privilege app user (member of creatorco_app) while the
// database is prepared as the owner — proves the app needs no DDL rights.
const E2E_APP_DATABASE_URL = process.env.DATABASE_URL_E2E_APP;

/**
 * E2E runs against a production build (`npm run build` first) and a dedicated
 * database that is recreated, migrated and seeded before the server starts.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, grep: /@mobile/ },
  ],
  webServer: {
    // The standalone server, exactly as the container runs it (Stage 17).
    command: `npx tsx e2e/prepare-db.ts && ${E2E_APP_DATABASE_URL ? `DATABASE_URL='${E2E_APP_DATABASE_URL}' ` : ""}PORT=${PORT} node scripts/start-standalone.mjs`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: "test",
      APP_URL: BASE_URL,
      DATABASE_URL: E2E_DATABASE_URL,
      SEED_DEMO_PASSWORD: process.env.SEED_DEMO_PASSWORD ?? "CreatorCo-demo-2026",
      // Every E2E request comes from one address; loosen the per-network limits (dev/test only).
      RATE_LIMIT_MULTIPLIER: "50",
      ANALYTICS_CAMPAIGNS: "e2e_launch",
    },
  },
});
