import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { KEY_ENV_TAG, WEBHOOK_TOLERANCE_SECONDS, type PartnerEnvironment } from "./domain";

/**
 * Partner credentials (Stage 12b).
 *
 * - API keys: 256 bits of randomness; only SHA-256(key) is stored (a slow
 *   hash adds nothing at this entropy). Compared in constant time.
 * - Webhook signing secrets are DERIVED, never stored:
 *   HMAC-SHA256(PARTNER_WEBHOOK_ROOT_KEY, "webhook:<endpoint id>:<version>").
 *   Rotating bumps the version. The `ops` schema keeps no secrets.
 * - Signatures: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`
 *   (one `v1=` per valid secret during a rotation).
 */

const DEV_ONLY_ROOT = "creatorco-dev-only-partner-webhook-root-key-not-for-production";
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function rootKey(): string {
  const configured = process.env.PARTNER_WEBHOOK_ROOT_KEY;
  if (configured) {
    if (configured.length < 32) throw new Error("PARTNER_WEBHOOK_ROOT_KEY must be at least 32 characters");
    return configured;
  }
  const env = process.env.APP_ENV ?? "development";
  if (env === "development" || env === "test") return DEV_ONLY_ROOT;
  throw new Error("PARTNER_WEBHOOK_ROOT_KEY must be set outside development and test");
}

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateApiKey(environment: PartnerEnvironment): { key: string; prefix: string; hash: string } {
  const idBytes = randomBytes(8);
  const id = [...idBytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
  const prefix = `cck_${KEY_ENV_TAG[environment]}_${id}`;
  const key = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function apiKeyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function deriveWebhookSecret(endpointId: string, version: number): string {
  return `whsec_${createHmac("sha256", rootKey()).update(`webhook:${endpointId}:${version}`).digest("base64url")}`;
}

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeader(secrets: string[], timestamp: number, body: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${signWebhook(s, timestamp, body)}`)].join(",");
}

/**
 * Receiver-side verification (what a partner implements; also used in tests
 * and the sandbox script). Rejects stale timestamps and compares in constant
 * time against every `v1=` signature.
 */
export function verifyWebhookSignature(input: {
  header: string | null;
  body: string;
  secret: string;
  now?: Date;
  toleranceSeconds?: number;
}): boolean {
  if (!input.header) return false;
  const parts = input.header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  if (!Number.isInteger(t)) return false;
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - t) > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return false;
  const expected = Buffer.from(signWebhook(input.secret, t, input.body), "hex");
  return parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3), "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

/** Stable hash of a decision request body, to detect a reused idempotency key with a different body. */
export const requestHash = (canonical: string) => createHash("sha256").update(canonical).digest("hex");
