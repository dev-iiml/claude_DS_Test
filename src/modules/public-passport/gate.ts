import { createDb, type Database } from "@/db/create-db";

import { resolvePassportSlug, type Resolution } from "./page-service";

/**
 * Used by the request proxy (`src/proxy.ts`) for `/p/<slug>` page requests:
 * a passport that isn't live answers 410 Gone before any page code runs, and
 * an old link redirects. A small dedicated pool, because the proxy can't use
 * the server-only app client.
 */
const globalForGate = globalThis as unknown as { __creatorcoPassportGateDb?: Database };

function gateDb(): Database {
  if (!globalForGate.__creatorcoPassportGateDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    globalForGate.__creatorcoPassportGateDb = createDb({
      url,
      max: 2,
      prepare: process.env.DATABASE_PREPARE !== "false",
    }).db;
  }
  return globalForGate.__creatorcoPassportGateDb;
}

export async function passportGate(slug: string): Promise<Resolution["kind"] | { redirect: string }> {
  const r = await resolvePassportSlug(gateDb(), slug);
  return r.kind === "redirect" ? { redirect: r.slug } : r.kind;
}

/** The same body for every link that isn't live — unknown, unpublished, withdrawn or taken down. */
export const GONE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Creator Passport — not available</title></head><body><main><h1>This Creator Passport isn't available</h1><p>The link may be wrong, or the creator has unpublished it.</p><p><a href="/">CreatorCo</a></p></main></body></html>`;
