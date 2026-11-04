import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditEvents, users } from "@/db/schema";
import { signIn } from "@/modules/identity/auth/auth-service";
import { createStaffAccount, findActiveStaffId } from "@/modules/identity/staff-accounts";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const STRONG = "Correct-Horse-9-Battery";

describe("staff accounts from the CLI (Stage 17)", () => {
  it("creates an active staff user who can sign in, audited without the password", async () => {
    const email = testEmail("staff");
    const r = await createStaffAccount(db, { email: email.toUpperCase(), role: "super_admin", password: STRONG });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [u] = await db.select().from(users).where(eq(users.id, r.userId));
    expect(u).toMatchObject({ email, role: "super_admin", status: "active" });
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, r.userId));
    expect(audit).toMatchObject({ eventType: "auth.staff_created", actorType: "system" });
    expect(JSON.stringify(audit)).not.toContain(STRONG);
    expect((await signIn(authDepsFor(db), { email, password: STRONG })).ok).toBe(true);
  });

  it("refuses creators, weak passwords, bad emails and duplicates", async () => {
    const email = testEmail("staff");
    expect(await createStaffAccount(db, { email, role: "creator", password: STRONG })).toEqual({
      ok: false,
      reason: "invalid_role",
    });
    expect(await createStaffAccount(db, { email, role: "risk_admin", password: "Short-1a" })).toEqual({
      ok: false,
      reason: "weak_password",
    });
    expect(await createStaffAccount(db, { email: "not-an-email", role: "risk_admin", password: STRONG })).toEqual({
      ok: false,
      reason: "invalid_email",
    });
    expect((await createStaffAccount(db, { email, role: "analyst", password: STRONG })).ok).toBe(true);
    expect(await createStaffAccount(db, { email, role: "analyst", password: STRONG })).toEqual({
      ok: false,
      reason: "email_taken",
    });
  });
});

describe("staff account audit trail", () => {
  it("records the staff member who created an account", async () => {
    const first = await createStaffAccount(db, {
      email: testEmail("staff"),
      role: "super_admin",
      password: STRONG,
    });
    if (!first.ok) throw new Error("bootstrap failed");
    const email = testEmail("staff");
    const second = await createStaffAccount(db, {
      email,
      role: "ops_admin",
      password: STRONG,
      createdBy: first.userId,
    });
    if (!second.ok) throw new Error("create failed");
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, second.userId));
    expect(audit).toMatchObject({ actorType: "user", actorId: first.userId, metadata: { bootstrap: false } });
    expect(await findActiveStaffId(db, email.toUpperCase())).toBe(second.userId);
  });
});
