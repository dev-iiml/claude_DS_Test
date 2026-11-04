import { createHmac } from "node:crypto";

import type { RateLimitSubject } from "./rules";
import { appEnvOf } from "@/lib/app-env";

/**
 * Keyed hash of a rate-limit subject (IP address, user id or partner id),
 * truncated to 128 bits: `rl<version>:<hex>`. The raw IP is never stored, and
 * counters are deleted after 48 hours.
 */
const DEV_ONLY_KEY = "creatorco-dev-only-rate-limit-key-not-for-production";
const KEY_VERSION = "1";

function key(): string {
  const configured = process.env.RATE_LIMIT_KEY;
  if (configured) {
    if (configured.length < 32) throw new Error("RATE_LIMIT_KEY must be at least 32 characters");
    return configured;
  }
  const env = appEnvOf();
  if (env === "development" || env === "test") return DEV_ONLY_KEY;
  throw new Error("RATE_LIMIT_KEY must be set outside development and test");
}

export function rateLimitSubjectKey(subject: RateLimitSubject, value: string): string {
  const digest = createHmac("sha256", key()).update(`${subject}:${value}`).digest("hex").slice(0, 32);
  return `rl${KEY_VERSION}:${digest}`;
}

/** Multiplier for local work and E2E runs; ignored outside development/test. */
export function rateLimitMultiplier(): number {
  const env = appEnvOf();
  if (env !== "development" && env !== "test") return 1;
  const raw = Number(process.env.RATE_LIMIT_MULTIPLIER ?? "1");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}
