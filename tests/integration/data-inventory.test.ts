import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ERASURE_SCOPES } from "@/modules/consent/domain";
import { DATA_INVENTORY, renderDataInventory } from "@/modules/privacy/data-inventory";
import { PURPOSES } from "@/modules/privacy/purposes";

import { connectTestDb } from "../support/db";

const { db } = connectTestDb();

describe("data inventory (Stage 16)", () => {
  it("lists exactly the tables in the database", async () => {
    const rows = await db.execute<{ t: string }>(sql`
      select table_schema || '.' || table_name as t from information_schema.tables
      where table_schema in ('public', 'iam', 'fin', 'ops', 'analytics') and table_type = 'BASE TABLE'`);
    const actual = [...rows].map((r) => r.t).sort();
    expect(DATA_INVENTORY.map((e) => e.table).sort()).toEqual(actual);
  });

  it("every personal-data table says how its data leaves the system", () => {
    const silent = DATA_INVENTORY.filter((e) => e.personal && !e.erasedBy?.length && !e.purge && !e.retained);
    expect(silent.map((e) => e.table)).toEqual([]);
  });

  it("every erasure scope a purpose uses is mapped to a table", () => {
    const mapped = new Set(DATA_INVENTORY.flatMap((e) => e.erasedBy ?? []));
    for (const scope of ERASURE_SCOPES) expect(mapped.has(scope), scope).toBe(true);
    for (const p of PURPOSES) for (const scope of p.erasure) expect(mapped.has(scope), `${p.key}:${scope}`).toBe(true);
  });

  it("docs/DATA_CLASSIFICATION.md carries the current inventory", () => {
    const doc = readFileSync(join(process.cwd(), "docs/DATA_CLASSIFICATION.md"), "utf8");
    expect(doc, "regenerate with: npx tsx scripts/render-data-inventory.ts").toContain(renderDataInventory());
  });
});
