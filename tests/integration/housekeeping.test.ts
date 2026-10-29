import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { authLoginAttempts, authSessions, mobileVerifications, users } from "@/db/schema";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { purgeAuthRecords } from "@/modules/identity/housekeeping";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const NOW = new Date("2031-06-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const hex = (c: string) => c.repeat(64);

describe("security-record housekeeping", () => {
  it("deletes old attempts, ended sessions and codes; keeps current ones", async () => {
    const r = await signUpCreator(auth, { email: testEmail("hk"), password: "a long enough passphrase" });
    if (!r.ok) throw new Error("signup failed");
    const [u] = await db.select({ identityId: users.authUserId }).from(users).where(eq(users.id, r.user.userId));

    const [oldAttempt, newAttempt] = await db
      .insert(authLoginAttempts)
      .values([
        { emailHash: hex("a"), succeeded: false, createdAt: daysAgo(181) },
        { emailHash: hex("a"), succeeded: false, createdAt: daysAgo(1) },
      ])
      .returning({ id: authLoginAttempts.id });
    const sessions = await db
      .insert(authSessions)
      .values([
        { identityId: u!.identityId, tokenHash: hex("1"), expiresAt: daysAgo(190), createdAt: daysAgo(200) },
        {
          identityId: u!.identityId,
          tokenHash: hex("2"),
          expiresAt: daysAgo(-5),
          revokedAt: daysAgo(185),
          createdAt: daysAgo(186),
        },
        { identityId: u!.identityId, tokenHash: hex("3"), expiresAt: daysAgo(-5), createdAt: daysAgo(2) },
      ])
      .returning({ id: authSessions.id });
    const codes = await db
      .insert(mobileVerifications)
      .values([
        {
          userId: r.user.userId,
          mobile: "+919000000001",
          codeHash: hex("b"),
          expiresAt: daysAgo(31),
          createdAt: daysAgo(31),
        },
        {
          userId: r.user.userId,
          mobile: "+919000000001",
          codeHash: hex("c"),
          expiresAt: daysAgo(0),
          createdAt: daysAgo(1),
        },
      ])
      .returning({ id: mobileVerifications.id });

    const result = await purgeAuthRecords(db, NOW);
    expect(result.login_attempts).toBeGreaterThanOrEqual(1);
    expect(result.sessions).toBeGreaterThanOrEqual(2);
    expect(result.mobile_verifications).toBeGreaterThanOrEqual(1);

    const leftAttempts = await db
      .select({ id: authLoginAttempts.id })
      .from(authLoginAttempts)
      .where(inArray(authLoginAttempts.id, [oldAttempt!.id, newAttempt!.id]));
    expect(leftAttempts.map((a) => a.id)).toEqual([newAttempt!.id]);
    const leftSessions = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        inArray(
          authSessions.id,
          sessions.map((s) => s.id),
        ),
      );
    expect(leftSessions.map((s) => s.id)).toEqual([sessions[2]!.id]);
    const leftCodes = await db
      .select({ id: mobileVerifications.id })
      .from(mobileVerifications)
      .where(
        inArray(
          mobileVerifications.id,
          codes.map((c) => c.id),
        ),
      );
    expect(leftCodes.map((c) => c.id)).toEqual([codes[1]!.id]);
  });
});
