import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { appEnvOf } from "@/lib/app-env";

import { CODE_LENGTH } from "./domain";

/**
 * Keys and codes for passport sharing (Stage 19). One server secret,
 * PASSPORT_SHARING_KEY, with a separate derived key per use (domain
 * separation): unlock cookies, IP pseudonyms in the access log and the brand
 * organisation GSTIN fingerprint. Access codes themselves are random; only
 * their SHA-256 hash is stored (80 bits of entropy — a slow hash adds nothing).
 */
const DEV_ONLY_KEY = "creatorco-dev-only-passport-sharing-key-not-for-production";

function rootKey(): string {
  const configured = process.env.PASSPORT_SHARING_KEY;
  if (configured) {
    if (configured.length < 32) throw new Error("PASSPORT_SHARING_KEY must be at least 32 characters");
    return configured;
  }
  const env = appEnvOf();
  if (env === "development" || env === "test") return DEV_ONLY_KEY;
  throw new Error("PASSPORT_SHARING_KEY must be set outside development and test");
}

const derived = (purpose: "unlock" | "ip" | "gstin") =>
  createHmac("sha256", rootKey()).update(`creatorco:${purpose}:v1`).digest();

/** `ip1:<128-bit hex>` — keyed, so the access log never holds an address or anything reversible without the key. */
export function ipPseudonym(ip: string | null): string | null {
  if (!ip) return null;
  return `ip1:${createHmac("sha256", derived("ip")).update(ip).digest("hex").slice(0, 32)}`;
}

/** `g1:<128-bit hex>` — a keyed GSTIN fingerprint. The GSTIN itself is never stored. */
export function gstinFingerprint(gstin: string): string {
  return `g1:${createHmac("sha256", derived("gstin")).update(gstin.toUpperCase()).digest("hex").slice(0, 32)}`;
}

// ── Access codes ────────────────────────────────────────────────────────────

/** Crockford base32: no I, L, O, U, so codes read back without confusion. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateAccessCode(): { code: string; display: string; hash: string; hint: string } {
  const bytes = randomBytes(CODE_LENGTH);
  const code = [...bytes].map((b) => ALPHABET[b & 31]).join("");
  return { code, display: formatAccessCode(code), hash: hashAccessCode(code), hint: code.slice(-4) };
}

export function formatAccessCode(code: string): string {
  return code.match(/.{1,4}/g)!.join("-");
}

/** What a person typed → the canonical code (case, spaces and dashes ignored; O→0, I/L→1). */
export function normaliseAccessCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return s.length === CODE_LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export const hashAccessCode = (code: string) => createHash("sha256").update(`ppc:${code}`).digest("hex");

/** Constant-time comparison of a typed code against a stored hash. */
export function accessCodeMatches(code: string, storedHash: string): boolean {
  const a = Buffer.from(hashAccessCode(code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Unlock cookies ──────────────────────────────────────────────────────────

/** One cookie per passport: an unlock never carries over to another creator's page. */
export function unlockCookieName(passportId: string): string {
  return `cc_pu_${passportId.replace(/-/g, "").slice(0, 16)}`;
}

const signUnlock = (passportId: string, codeId: string, exp: number) =>
  createHmac("sha256", derived("unlock")).update(`${passportId}.${codeId}.${exp}`).digest("base64url");

export function encodeUnlock(passportId: string, codeId: string, expiresAt: Date): string {
  const exp = expiresAt.getTime();
  return `v1.${codeId}.${exp}.${signUnlock(passportId, codeId, exp)}`;
}

/** The code id an unlock cookie names, if its signature and expiry check out for this passport. */
export function decodeUnlock(passportId: string, value: string | undefined, now = Date.now()): string | null {
  const m = /^v1\.([0-9a-f-]{36})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!m) return null;
  const [, codeId, expRaw, sig] = m;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return null;
  const expected = Buffer.from(signUnlock(passportId, codeId!, exp));
  const given = Buffer.from(sig!);
  return expected.length === given.length && timingSafeEqual(expected, given) ? codeId! : null;
}
