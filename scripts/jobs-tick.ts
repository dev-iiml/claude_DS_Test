import { config } from "dotenv";

import { createDb } from "@/db/create-db";
import { JOB_HANDLERS, tick } from "@/modules/jobs";

/** Local stand-in for the cron: `npm run jobs:tick` runs one scheduler tick against DATABASE_URL. */
config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, client } = createDb({ url, max: 1 });
  try {
    console.warn(await tick({ db, handlers: JOB_HANDLERS }, { limit: 50 }));
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("✗ tick failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
