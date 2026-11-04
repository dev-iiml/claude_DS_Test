import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { ProviderMode } from "@/providers/types";
import { appEnvOf } from "@/lib/app-env";

/**
 * Guardrails for Account Aggregator line items (Stage 09b, user decision
 * "keep all, inside guardrails"):
 *
 * - stored only in the `fin` schema, tied to the AA consent's data-life and
 *   erased with the check;
 * - narration and counterparty (the parts that identify people) encrypted
 *   with AES-256-GCM under FI_DATA_ENCRYPTION_KEY, bound to the check;
 * - mock/sandbox data is stored; LIVE line items are stored only when
 *   FI_LIVE_LINE_ITEM_RETENTION=true — off until counsel and the partner RE
 *   sign off. With it off, live data is analysed in memory and only derived
 *   totals are kept.
 *
 * Never in analytics, logs, audit metadata or the creator domain.
 */

const VERSION = "v1";
const DEV_ONLY_KEY = "creatorco-dev-only-fi-data-key-not-for-production";

function key(): Buffer {
  const configured = process.env.FI_DATA_ENCRYPTION_KEY;
  if (configured) {
    const raw = Buffer.from(configured, "base64");
    if (raw.length !== 32) throw new Error("FI_DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return raw;
  }
  const env = appEnvOf();
  if (env === "development" || env === "test") return createHash("sha256").update(DEV_ONLY_KEY).digest();
  throw new Error("FI_DATA_ENCRYPTION_KEY must be set outside development and test");
}

/** `v1.<iv>.<tag>.<ciphertext>` (base64url). `context` (the check id) is authenticated, so rows can't be swapped. */
export function sealFiText(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ct]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function openFiText(sealed: string, context: string): string {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unrecognised sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Opaque, non-reversible id for a provider's transaction reference (duplicate detection only). */
export function txnRefHash(accountId: string, txnRef: string): string {
  return createHash("sha256").update(`${accountId}\u0000${txnRef}`).digest("hex");
}

/** Whether line items from a provider in this mode may be stored. */
export function mayRetainLineItems(mode: ProviderMode, env: Record<string, string | undefined> = process.env): boolean {
  return mode !== "live" || env.FI_LIVE_LINE_ITEM_RETENTION === "true";
}
