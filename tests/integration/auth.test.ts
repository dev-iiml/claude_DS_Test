import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { authIdentities, authSessions, users } from "@/db/schema";
import {
  LOGIN_MAX_FAILURES,
  resolveSession,
  signIn,
  signOut,
  signUpCreator,
} from "@/modules/identity/auth/auth-service";

import { authDepsFor, testEmail, connectTestDb } from "../support/db";

const { db } = connectTestDb();
const deps = authDepsFor(db);
const PASSWORD = "a long enough passphrase";

describe("sign up", () => {
  it("creates an identity, a creator user and a session; stores only hashes", async () => {
    const email = testEmail();
    const r = await signUpCreator(deps, { email: email.toUpperCase(), password: PASSWORD });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.user.role).toBe("creator");
    expect(r.user.email).toBe(email);

    const [identity] = await db.select().from(authIdentities).where(eq(authIdentities.email, email));
    expect(identity!.passwordHash).not.toContain(PASSWORD);

    const [session] = await db.select().from(authSessions).where(eq(authSessions.identityId, identity!.id));
    expect(session!.tokenHash).not.toBe(r.session.token);
    expect(await resolveSession(deps, r.session.token)).toMatchObject({ userId: r.user.userId, role: "creator" });
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    const email = testEmail();
    await signUpCreator(deps, { email, password: PASSWORD });
    const again = await signUpCreator(deps, { email: email.toUpperCase(), password: PASSWORD });
    expect(again).toEqual({ ok: false, reason: "email_taken" });
  });
});

describe("sign in", () => {
  it("issues a fresh session for valid credentials", async () => {
    const email = testEmail();
    await signUpCreator(deps, { email, password: PASSWORD });
    const r = await signIn(deps, { email, password: PASSWORD });
    expect(r.ok).toBe(true);
    if (r.ok) expect(await resolveSession(deps, r.session.token)).not.toBeNull();
  });

  it("returns the same generic failure for a wrong password and an unknown account", async () => {
    const email = testEmail();
    await signUpCreator(deps, { email, password: PASSWORD });
    expect(await signIn(deps, { email, password: "wrong password here" })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(await signIn(deps, { email: testEmail("nobody"), password: PASSWORD })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it(`locks the account after ${LOGIN_MAX_FAILURES} failures in the window`, async () => {
    const email = testEmail();
    await signUpCreator(deps, { email, password: PASSWORD });
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await signIn(deps, { email, password: "wrong password here" });
    expect(await signIn(deps, { email, password: PASSWORD })).toEqual({ ok: false, reason: "locked" });

    const later = authDepsFor(db, () => new Date(Date.now() + 16 * 60_000));
    expect((await signIn(later, { email, password: PASSWORD })).ok).toBe(true);
  });

  it("refuses suspended users and drops their sessions", async () => {
    const email = testEmail();
    const r = await signUpCreator(deps, { email, password: PASSWORD });
    if (!r.ok) throw new Error("setup failed");
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, r.user.userId));
    expect(await signIn(deps, { email, password: PASSWORD })).toEqual({ ok: false, reason: "inactive" });
    expect(await resolveSession(deps, r.session.token)).toBeNull();
  });
});

describe("sessions", () => {
  it("expire after the TTL", async () => {
    const r = await signUpCreator(deps, { email: testEmail(), password: PASSWORD });
    if (!r.ok) throw new Error("setup failed");
    const future = authDepsFor(db, () => new Date(Date.now() + 25 * 3_600_000));
    expect(await resolveSession(future, r.session.token)).toBeNull();
  });

  it("are revoked on sign-out", async () => {
    const r = await signUpCreator(deps, { email: testEmail(), password: PASSWORD });
    if (!r.ok) throw new Error("setup failed");
    await signOut(deps, r.session.token);
    expect(await resolveSession(deps, r.session.token)).toBeNull();
  });

  it("ignore garbage tokens", async () => {
    expect(await resolveSession(deps, "")).toBeNull();
    expect(await resolveSession(deps, "x".repeat(500))).toBeNull();
    expect(await resolveSession(deps, "not-a-real-token")).toBeNull();
  });
});
