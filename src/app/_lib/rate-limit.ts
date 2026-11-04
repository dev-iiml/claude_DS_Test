import "server-only";

import { isIP } from "node:net";

import { headers } from "next/headers";

import { getDb } from "@/db";
import { isDevOrTest } from "@/lib/app-env";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { consumeRateLimit, type RateLimitBucket, type RateLimitResult } from "@/modules/rate-limit";

/**
 * Request-side rate limiting (Stage 16). The client IP comes from the header
 * the platform's edge proxy sets (`CLIENT_IP_HEADER`). It is only as
 * trustworthy as that proxy:
 * - `CLIENT_IP_TRUSTED_HOPS=0` (default): the edge overwrites the header with
 *   the client address (Vercel) — use its first entry;
 * - `CLIENT_IP_TRUSTED_HOPS=n`: n proxies of ours append to it (nginx, load
 *   balancers) — use the n-th entry from the right; anything left of it is
 *   client-supplied and ignored.
 * IPv6 clients are counted per /64 (one subscriber's block). The address is
 * hashed with a server key before it is counted and never stored or logged.
 */
function expandIpv6(ip: string): string[] {
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? Array(Math.max(0, 8 - h.length - t.length)).fill("0") : [];
  return [...h, ...fill, ...t];
}

export function clientIpFrom(source: Pick<Headers, "get">): string | null {
  const env = getServerEnv();
  const entries = (source.get(env.CLIENT_IP_HEADER) ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const hops = env.CLIENT_IP_TRUSTED_HOPS;
  const candidate = hops === 0 ? entries[0] : entries[entries.length - hops];
  const ip = candidate?.replace(/^\[|\]$/g, "").replace(/%.*$/, "") ?? "";
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version === 6) {
    const groups = expandIpv6(ip.toLowerCase());
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) is the IPv4 client.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return mapped[1]!;
    return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return null;
}

/** The current request's client IP (Server Components and Server Actions); null when unknown. */
export async function clientIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}

/**
 * Counts a request. Network (`ip`) buckets with no usable client address: in
 * development/test everything shares one local bucket; elsewhere the request
 * is not counted (a shared "unknown" bucket would let one client lock everyone
 * out) and a warning is logged — the per-account limits still apply.
 */
export async function rateLimit(bucket: RateLimitBucket, subject: string | null): Promise<RateLimitResult> {
  if (subject === null) {
    if (!isDevOrTest()) {
      logger.warn("rate_limit.no_client_ip", { bucket });
      return { ok: true };
    }
    subject = "local";
  }
  return consumeRateLimit(getDb(), { bucket, subject });
}

export const RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";
