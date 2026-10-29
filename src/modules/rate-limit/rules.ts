/**
 * Rate-limit rules (Stage 16) — pure. Fixed windows counted in Postgres
 * (`ops.rate_limit_counters`), keyed by a keyed hash of the client IP, the
 * user id or the partner id — never a raw IP, email or token.
 *
 * These protect the service (sign-up and sign-in floods, OTP/SMS cost,
 * scraping, partner runaway loops). They sit on top of the business limits
 * that already exist (per-account sign-in lockout, OTP sends per number, bureau
 * checks per 30 days), which they never replace.
 */
export const RATE_LIMIT_RULES_VERSION = "rl-0.1.0";

export type RateLimitSubject = "ip" | "user" | "partner";

export interface RateLimitRule {
  subject: RateLimitSubject;
  limit: number;
  windowSeconds: number;
  /** What happens when the limit is hit. `skip` = the request succeeds but the side effect is not done. */
  onLimit: "reject" | "skip";
  description: string;
}

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const RATE_LIMITS = {
  "auth.sign_up": {
    subject: "ip",
    // Generous: creators often join together on one network (meetups, campuses, carrier NAT).
    limit: 30,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "New accounts from one network per hour.",
  },
  "auth.sign_in": {
    subject: "ip",
    limit: 60,
    windowSeconds: 10 * MIN,
    onLimit: "reject",
    description: "Sign-in attempts from one network per 10 minutes (on top of the per-account lockout).",
  },
  "otp.send": {
    subject: "ip",
    limit: 20,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "Verification codes requested from one network per hour (on top of the per-number limit).",
  },
  "otp.verify": {
    subject: "user",
    limit: 30,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "Code entries per account per hour (on top of the per-code attempt limit).",
  },
  "eligibility.start": {
    subject: "user",
    limit: 10,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Eligibility checks started per account per day.",
  },
  "access.request": {
    subject: "user",
    limit: 20,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Access requests per account per day.",
  },
  "analytics.anonymous_view": {
    subject: "ip",
    limit: 30,
    windowSeconds: HOUR,
    onLimit: "skip",
    description: "Signed-out page views recorded per network per hour (the page still renders).",
  },
  "analytics.client_event": {
    subject: "user",
    limit: 300,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "Screen-view events sent by an app per account per hour.",
  },
  "partner.api": {
    subject: "partner",
    limit: 600,
    windowSeconds: MIN,
    onLimit: "reject",
    description: "Partner API calls per partner per minute.",
  },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** Counters older than this are deleted (the longest window plus margin). */
export const RATE_LIMIT_RETENTION_HOURS = 48;

export interface WindowState {
  windowStart: Date;
  retryAfterSeconds: number;
}

/** The fixed window `now` falls in, and seconds until it ends. */
export function windowFor(rule: Pick<RateLimitRule, "windowSeconds">, now: Date): WindowState {
  const ms = rule.windowSeconds * 1000;
  const start = Math.floor(now.getTime() / ms) * ms;
  return {
    windowStart: new Date(start),
    retryAfterSeconds: Math.max(1, Math.ceil((start + ms - now.getTime()) / 1000)),
  };
}

/** Effective limit: `multiplier` (development/test only) loosens limits for local work and E2E runs. */
export function effectiveLimit(rule: Pick<RateLimitRule, "limit">, multiplier = 1): number {
  return Math.max(1, Math.floor(rule.limit * multiplier));
}
