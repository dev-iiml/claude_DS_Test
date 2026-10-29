import { createHmac } from "node:crypto";
import { appEnvOf } from "@/lib/app-env";

/**
 * Keyed PAN fingerprint for duplicate-identity detection (Stage 11, user
 * decision). HMAC-SHA256 under a server secret: equal PANs give equal
 * fingerprints, but without the secret the PAN can't be recovered or
 * brute-forced from the stored value. Versioned so the key can be rotated.
 * Stored only on the check and erased with its inputs.
 */
const VERSION = "v1";
const DEV_ONLY_SECRET = "creatorco-dev-only-pan-fingerprint-secret-not-for-production";

function secret(): string {
  const configured = process.env.PAN_FINGERPRINT_SECRET;
  if (configured) {
    if (configured.length < 32) throw new Error("PAN_FINGERPRINT_SECRET must be at least 32 characters");
    return configured;
  }
  const env = appEnvOf();
  if (env === "development" || env === "test") return DEV_ONLY_SECRET;
  throw new Error("PAN_FINGERPRINT_SECRET must be set outside development and test");
}

export function panFingerprint(pan: string): string {
  const normalised = pan.trim().toUpperCase();
  return `${VERSION}:${createHmac("sha256", secret()).update(normalised).digest("hex")}`;
}

/**
 * Keyed fingerprint of a mobile number within one check, so the same number
 * isn't searched twice. The number itself is never stored.
 */
export function mobileFingerprint(applicationId: string, mobile: string): string {
  return `${VERSION}:${createHmac("sha256", secret()).update(`mobile:${applicationId}:${mobile}`).digest("hex")}`;
}
