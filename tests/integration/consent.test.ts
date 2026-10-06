import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { consentDefinitions, consentReceipts } from "@/db/schema";
import {
  ConsentError,
  getActiveDefinition,
  grantConsent,
  hasValidConsent,
  withdrawConsent,
  type ConsentKey,
} from "@/modules/consent";
import { signUpCreator } from "@/modules/identity/auth/auth-service";

import { authDepsFor, testEmail, connectTestDb } from "../support/db";

/** Uses a test-only purpose key so version changes don't affect other suites. */
const { db } = connectTestDb();
const KEY = `test_purpose_${Date.now().toString(36)}` as ConsentKey;

async function newUserId() {
  const r = await signUpCreator(authDepsFor(db), { email: testEmail(), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  return r.user.userId;
}

async function publish(version: number, activeFrom: Date) {
  await db
    .update(consentDefinitions)
    .set({ activeTo: activeFrom })
    .where(and(eq(consentDefinitions.key, KEY), isNull(consentDefinitions.activeTo)));
  const [def] = await db
    .insert(consentDefinitions)
    .values({ key: KEY, version, title: `T${version}`, purpose: "test", body: `body v${version}`, activeFrom })
    .returning();
  return def!;
}

describe("consent service", () => {
  it("handles grant, idempotency, re-consent on new version, and withdrawal", async () => {
    const userId = await newUserId();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const v1 = await publish(1, t0);

    const r1 = await grantConsent(db, {
      userId,
      key: KEY,
      consentDefinitionId: v1.id,
      source: "onboarding",
      now: new Date("2026-02-01Z"),
    });
    expect(r1).toMatchObject({ status: "granted", consentDefinitionId: v1.id });

    // Idempotent: a double-submit returns the same receipt.
    const again = await grantConsent(db, {
      userId,
      key: KEY,
      consentDefinitionId: v1.id,
      source: "onboarding",
      now: new Date("2026-02-01Z"),
    });
    expect(again.id).toBe(r1.id);

    expect(await hasValidConsent(db, userId, KEY, new Date("2026-03-01Z"))).toBe(true);

    // Publishing v2 means v1 consent no longer counts.
    const v2 = await publish(2, new Date("2026-04-01T00:00:00Z"));
    expect((await getActiveDefinition(db, KEY, new Date("2026-05-01Z")))?.version).toBe(2);
    expect(await hasValidConsent(db, userId, KEY, new Date("2026-05-01Z"))).toBe(false);

    // A grant against the superseded version is refused.
    await expect(
      grantConsent(db, {
        userId,
        key: KEY,
        consentDefinitionId: v1.id,
        source: "onboarding",
        now: new Date("2026-05-01Z"),
      }),
    ).rejects.toMatchObject({ code: "definition_not_active" });

    const r2 = await grantConsent(db, {
      userId,
      key: KEY,
      consentDefinitionId: v2.id,
      source: "settings",
      now: new Date("2026-05-01Z"),
    });
    expect(await hasValidConsent(db, userId, KEY, new Date("2026-05-02Z"))).toBe(true);

    const withdrawn = await withdrawConsent(db, { userId, receiptId: r2.id, now: new Date("2026-06-01Z") });
    expect(withdrawn).toMatchObject({ status: "withdrawn" });
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(await hasValidConsent(db, userId, KEY, new Date("2026-06-02Z"))).toBe(false);

    // History is preserved: both receipts remain.
    const all = await db.select().from(consentReceipts).where(eq(consentReceipts.userId, userId));
    expect(all).toHaveLength(2);
  });

  it("refuses unknown definitions and double withdrawal", async () => {
    const userId = await newUserId();
    await expect(
      grantConsent(db, {
        userId,
        key: KEY,
        consentDefinitionId: "00000000-0000-4000-8000-000000000000",
        source: "onboarding",
      }),
    ).rejects.toBeInstanceOf(ConsentError);
    await expect(
      withdrawConsent(db, { userId, receiptId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({
      code: "receipt_not_found",
    });
  });

  it("database blocks rewriting a receipt", async () => {
    const userId = await newUserId();
    const active = await getActiveDefinition(db, KEY);
    const r = await grantConsent(db, { userId, key: KEY, consentDefinitionId: active!.id, source: "onboarding" });
    await expect(
      db
        .update(consentReceipts)
        .set({ grantedAt: new Date("2020-01-01Z") })
        .where(eq(consentReceipts.id, r.id)),
    ).rejects.toThrow();
    await expect(db.delete(consentReceipts).where(eq(consentReceipts.id, r.id))).rejects.toThrow();
  });
});
