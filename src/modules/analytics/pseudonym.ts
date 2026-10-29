import { createHmac } from "node:crypto";
import { appEnvOf } from "@/lib/app-env";

/**
 * Pseudonymous analytics subject (Stage 15): HMAC-SHA256 of the user id under
 * a server key, truncated to 128 bits and prefixed with the key version
 * (`a<version>:<hex>`). It can't be turned back into the user id without the
 * key, and events keep no timestamp (only the India-time day), so they can't
 * be re-linked by matching times either. This is pseudonymisation, not
 * anonymisation: whoever holds the key can link events to an account.
 *
 * Rotation: set a new ANALYTICS_PSEUDONYM_KEY with a higher
 * ANALYTICS_PSEUDONYM_KEY_VERSION and move the old key into
 * ANALYTICS_PSEUDONYM_PREVIOUS_KEYS ("<version>:<key>,…"), so erasure still
 * finds events recorded under earlier keys. Funnels don't join across a
 * rotation (new pseudonyms start).
 */
const DEV_ONLY_KEY = "creatorco-dev-only-analytics-pseudonym-key-not-for-production";

interface PseudonymKey {
  version: string;
  key: string;
}

function currentKey(): PseudonymKey {
  const version = process.env.ANALYTICS_PSEUDONYM_KEY_VERSION ?? "1";
  if (!/^[0-9]{1,4}$/.test(version)) throw new Error("ANALYTICS_PSEUDONYM_KEY_VERSION must be a number");
  const configured = process.env.ANALYTICS_PSEUDONYM_KEY;
  if (configured) {
    if (configured.length < 32) throw new Error("ANALYTICS_PSEUDONYM_KEY must be at least 32 characters");
    return { version, key: configured };
  }
  const env = appEnvOf();
  if (env === "development" || env === "test") return { version, key: DEV_ONLY_KEY };
  throw new Error("ANALYTICS_PSEUDONYM_KEY must be set outside development and test");
}

function previousKeys(): PseudonymKey[] {
  const raw = process.env.ANALYTICS_PSEUDONYM_PREVIOUS_KEYS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf(":");
      const version = entry.slice(0, i);
      const key = entry.slice(i + 1);
      if (i < 1 || !/^[0-9]{1,4}$/.test(version) || key.length < 32)
        throw new Error("ANALYTICS_PSEUDONYM_PREVIOUS_KEYS must be '<version>:<key of 32+ chars>' entries");
      return { version, key };
    });
}

function pseudonym(userId: string, k: PseudonymKey): string {
  const digest = createHmac("sha256", k.key).update(`subject:${userId}`).digest("hex").slice(0, 32);
  return `a${k.version}:${digest}`;
}

/** The creator's pseudonym under the current key (used for new events). */
export function analyticsSubject(userId: string): string {
  return pseudonym(userId, currentKey());
}

/** The creator's pseudonyms under the current and every previous key (used for erasure). */
export function analyticsSubjects(userId: string): string[] {
  return [...new Set([currentKey(), ...previousKeys()].map((k) => pseudonym(userId, k)))];
}
