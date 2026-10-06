import { describe, expect, it } from "vitest";

import { hashPassword, needsRehash, verifyPassword } from "@/modules/identity/auth/password";
import { evaluatePassword } from "@/modules/identity/auth/password-policy";
import { signUpSchema } from "@/modules/identity/auth/schemas";
import { emailThrottleKey, generateSessionToken, normaliseEmail, sha256Hex } from "@/modules/identity/auth/tokens";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("correct horse battery stapl", hash)).resolves.toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"));
  });

  it("fails closed on malformed hashes and flags weak parameters", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    expect(needsRehash("scrypt$1024$8$1$c2FsdA==$a2V5")).toBe(true);
    expect(needsRehash(await hashPassword("a strong passphrase"))).toBe(false);
  });
});

describe("tokens", () => {
  it("generates 256-bit url-safe tokens and stores only hashes", () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSessionToken()).not.toBe(t);
  });

  it("normalises emails and derives a non-reversible throttle key", () => {
    expect(normaliseEmail("  Asha@Example.TEST ")).toBe("asha@example.test");
    expect(emailThrottleKey("Asha@example.test")).toBe(emailThrottleKey("asha@example.test"));
    expect(emailThrottleKey("asha@example.test")).not.toContain("asha");
  });
});

describe("password policy (shared by the live checklist and the server)", () => {
  const met = (p: string) => Object.fromEntries(evaluatePassword(p).checks.map((c) => [c.key, c.met]));

  it("reports each rule independently", () => {
    expect(met("")).toEqual({ length: false, lower: false, upper: false, digit: false, special: false });
    expect(met("abcdefgh")).toMatchObject({ length: true, lower: true, upper: false, digit: false, special: false });
    expect(met("Abcdef1!")).toEqual({ length: true, lower: true, upper: true, digit: true, special: true });
  });

  it("requires at least 8 characters and all four character types", () => {
    expect(evaluatePassword("Abc1!").valid).toBe(false);
    expect(evaluatePassword("abcdef1!").valid).toBe(false);
    expect(evaluatePassword("ABCDEF1!").valid).toBe(false);
    expect(evaluatePassword("Abcdefg!").valid).toBe(false);
    expect(evaluatePassword("Abcdefg1").valid).toBe(false);
    expect(evaluatePassword("Abcdef1!").valid).toBe(true);
    expect(evaluatePassword(`A1!${"a".repeat(130)}`).valid).toBe(false);
  });

  it("is enforced server-side on sign-up", () => {
    const base = { email: "a@b.test" };
    expect(signUpSchema.safeParse({ ...base, password: "short", confirmPassword: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, password: "Abcdef1!", confirmPassword: "Abcdef1!" }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, password: "Abcdef1!", confirmPassword: "Abcdef1?" }).success).toBe(false);
  });
});
