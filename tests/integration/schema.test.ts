import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditEvents, authIdentities, consentDefinitions, creatorProfiles, users } from "@/db/schema";

import { testEmail, connectTestDb } from "../support/db";

/**
 * The database is rebuilt from migrations by the global setup, so these tests
 * also prove that migrations apply cleanly to an empty database.
 */
const { db } = connectTestDb();

async function newUser() {
  const email = testEmail();
  const [identity] = await db.insert(authIdentities).values({ email, passwordHash: "scrypt$x" }).returning();
  const [user] = await db.insert(users).values({ authUserId: identity!.id, email }).returning();
  return user!;
}

async function expectDbError(fn: () => Promise<unknown>, pattern: RegExp) {
  const err = await fn().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the database to reject this").not.toBeNull();
  const message =
    err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : String(err);
  expect(message).toMatch(pattern);
}

describe("migrations", () => {
  it("create every Phase 1 foundation table", async () => {
    const rows = await db.execute<{ table_schema: string; table_name: string }>(sql`
      select table_schema, table_name from information_schema.tables
      where table_schema in ('public', 'iam') and table_type = 'BASE TABLE' order by 1, 2`);
    const names = rows.map((r) => `${r.table_schema}.${r.table_name}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "iam.identities",
        "iam.sessions",
        "iam.login_attempts",
        "public.users",
        "public.creator_profiles",
        "public.creator_preferences",
        "public.creator_categories",
        "public.social_platforms",
        "public.creator_social_accounts",
        "public.creator_social_snapshots",
        "public.consent_definitions",
        "public.consent_receipts",
        "public.audit_events",
      ]),
    );
  });

  it("enable row-level security on every table (deny-by-default)", async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'iam') and c.relkind = 'r'`);
    expect(rows.length).toBeGreaterThanOrEqual(13);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("load reference categories and platforms", async () => {
    const [cats] = await db.execute<{ n: number }>(sql`select count(*)::int as n from creator_categories`);
    const [plats] = await db.execute<{ n: number }>(sql`select count(*)::int as n from social_platforms`);
    expect(cats!.n).toBeGreaterThanOrEqual(10);
    expect(plats!.n).toBeGreaterThanOrEqual(5);
  });
});

describe("database constraints", () => {
  it("reject a GSTIN unless GST status is registered", async () => {
    const user = await newUser();
    await expectDbError(
      () =>
        db.insert(creatorProfiles).values({
          userId: user.id,
          legalName: "Test Person",
          displayName: "Test",
          gstStatus: "not_registered",
          gstin: "27AAPFU0939F1ZV",
        }),
      /creator_profiles_gstin_requires_registration/,
    );
  });

  it("reject a completed profile that is missing required fields", async () => {
    const user = await newUser();
    await expectDbError(
      () =>
        db.insert(creatorProfiles).values({
          userId: user.id,
          legalName: "Test Person",
          displayName: "Test",
          profileStatus: "completed",
          completedAt: new Date(),
        }),
      /creator_profiles_completed_is_whole/,
    );
  });

  it("reject unknown roles and GST statuses", async () => {
    const email = testEmail();
    const [identity] = await db.insert(authIdentities).values({ email, passwordHash: "x" }).returning();
    await expectDbError(
      () => db.execute(sql`insert into users (auth_user_id, email, role) values (${identity!.id}, ${email}, 'lender')`),
      /users_role_valid/,
    );
    const user = await newUser();
    await expectDbError(
      () =>
        db.execute(
          sql`insert into creator_profiles (user_id, legal_name, display_name, gst_status) values (${user.id}, 'Ab Cd', 'Ab', 'exempt')`,
        ),
      /creator_profiles_gst_status_valid/,
    );
  });

  it("keep audit_events append-only", async () => {
    const [ev] = await db
      .insert(auditEvents)
      .values({ actorType: "system", eventType: "test.event", entityType: "system" })
      .returning();
    await expectDbError(
      () =>
        db
          .update(auditEvents)
          .set({ eventType: "test.changed" })
          .where(sql`id = ${ev!.id}`),
      /append-only/,
    );
    await expectDbError(() => db.delete(auditEvents).where(sql`id = ${ev!.id}`), /append-only/);
  });

  it("cap audit metadata size and shape at the database level", async () => {
    await expectDbError(
      () =>
        db.execute(
          sql`insert into audit_events (actor_type, event_type, entity_type, metadata) values ('system', 'test.event', 'system', '[1,2]'::jsonb)`,
        ),
      /audit_events_metadata_bounded/,
    );
  });

  it("make published consent text immutable", async () => {
    await expectDbError(
      () =>
        db
          .update(consentDefinitions)
          .set({ body: "changed" })
          .where(sql`key = 'creator_profile'`),
      /immutable/,
    );
    await expectDbError(() => db.delete(consentDefinitions).where(sql`key = 'creator_profile'`), /cannot be deleted/);
  });
});
