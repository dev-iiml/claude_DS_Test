import { sql } from "drizzle-orm";

import { getDb } from "@/db";

import { json, route } from "../_lib/http";

/** Liveness + database reachability. No version or environment details are exposed. */
export const GET = route("health", async () => {
  await getDb().execute(sql`select 1`);
  return json({ status: "ok" });
});
