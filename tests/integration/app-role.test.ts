import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { connectTestDb } from "../support/db";

/**
 * Stage 16: the app's database role can read and write rows but never change
 * the schema, truncate, or read the migration history. Skipped where the role
 * couldn't be created (the migration user lacks CREATEROLE).
 */
const { db } = connectTestDb();

let available = false;
beforeAll(async () => {
  const [row] = await db.execute<{ exists: boolean }>(
    sql`select exists (select 1 from pg_roles where rolname = 'creatorco_app') as exists`,
  );
  available = Boolean(row?.exists);
  if (available) await db.execute(sql`grant creatorco_app to current_user`).catch(() => (available = false));
});

/** Runs `statement` as creatorco_app inside a rolled-back transaction; returns the error code, or null. */
async function asApp(statement: ReturnType<typeof sql>): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role creatorco_app`);
      await tx.execute(statement);
      throw new Error("rollback");
    });
  } catch (error) {
    if (error instanceof Error && error.message === "rollback") return null;
    const cause = (error as { cause?: { code?: string } }).cause ?? (error as { code?: string });
    return cause.code ?? "unknown";
  }
  return null;
}

describe("least-privilege app role", () => {
  it("reads and writes rows in every domain schema", async (ctx) => {
    if (!available) ctx.skip();
    expect(await asApp(sql`select count(*) from public.users`)).toBeNull();
    expect(await asApp(sql`select count(*) from iam.sessions`)).toBeNull();
    expect(await asApp(sql`select count(*) from fin.credit_applications`)).toBeNull();
    expect(await asApp(sql`select count(*) from analytics.events`)).toBeNull();
    expect(
      await asApp(
        sql`insert into ops.rate_limit_counters (bucket, subject_key, window_start) values ('auth.sign_in', ${"rl1:" + "0".repeat(32)}, now())`,
      ),
    ).toBeNull();
  });

  it("can't change the schema, truncate, or read migration history", async (ctx) => {
    if (!available) ctx.skip();
    const denied = "42501"; // insufficient_privilege
    expect(await asApp(sql`create table public.app_role_probe (id int)`)).toBe(denied);
    expect(await asApp(sql`alter table public.users add column probe int`)).toBe(denied);
    expect(await asApp(sql`drop table ops.rate_limit_counters`)).toBe(denied);
    expect(await asApp(sql`truncate public.audit_events`)).toBe(denied);
    expect(await asApp(sql`select * from drizzle.__drizzle_migrations`)).toBe(denied);
    expect(await asApp(sql`select public.grant_app_access()`)).toBe(denied);
  });

  it("every RLS-protected table has the app policy and grants", async (ctx) => {
    if (!available) ctx.skip();
    const missing = await db.execute<{ t: string }>(sql`
      select n.nspname || '.' || c.relname as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'iam', 'fin', 'ops', 'analytics') and c.relkind in ('r', 'p')
        and (
          (c.relrowsecurity and not exists (
            select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname
              and p.policyname = 'creatorco_app_all'))
          or not has_table_privilege('creatorco_app', c.oid, 'select, insert, update, delete')
        )`);
    expect([...missing].map((r) => r.t)).toEqual([]);
  });
});
