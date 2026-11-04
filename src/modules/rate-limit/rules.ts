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
export const RATE_LIMIT_RULES_VERSION = "rl-0.3.0";

export type RateLimitSubject = "ip" | "user" | "partner" | "passport";

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
  "brand_work.create": {
    subject: "user",
    limit: 30,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Brand-work records created per account per day.",
  },
  "brand_work.upload": {
    subject: "user",
    limit: 60,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "Brand-work document uploads per account per hour.",
  },
  "brand_work.submit": {
    subject: "user",
    limit: 30,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Brand-work records submitted for verification per account per day.",
  },
  "brand_work.payment_check": {
    subject: "user",
    limit: 10,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Brand payment checks against shared bank data per account per day.",
  },
  // Stage 19 — Verified Creator Passport and brand organisations.
  "passport.public_view": {
    subject: "ip",
    limit: 300,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "Public passport page views per network per hour (anti-scraping).",
  },
  "passport.code_attempt": {
    subject: "ip",
    limit: 20,
    windowSeconds: 15 * MIN,
    onLimit: "reject",
    description:
      "Access-code attempts per network per 15 minutes — the 15-minute lockout (the creator is told after 10 wrong codes on their passport).",
  },
  "passport.report": {
    subject: "ip",
    limit: 10,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "'Report this page' submissions per network per hour.",
  },
  "passport.code_create": {
    subject: "user",
    limit: 50,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Access codes a creator creates per day.",
  },
  "passport.photo_upload": {
    subject: "user",
    limit: 20,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Passport photo uploads per creator per day.",
  },
  "brand.signup_code": {
    subject: "ip",
    limit: 10,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "Brand sign-up email codes requested per network per hour.",
  },
  "brand.signup": {
    subject: "ip",
    limit: 10,
    windowSeconds: HOUR,
    onLimit: "reject",
    description: "Brand sign-up attempts per network per hour.",
  },
  "brand.unlock": {
    subject: "user",
    limit: 200,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Passport unlock attempts per brand member per day (the organisation quota applies too).",
  },
  "brand.invite": {
    subject: "user",
    limit: 20,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Member invitations per owner per day.",
  },
  "brand.discovery": {
    subject: "user",
    limit: 100,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Discovery searches per brand member per day.",
  },
  "brand.logo_upload": {
    subject: "user",
    limit: 20,
    windowSeconds: DAY,
    onLimit: "reject",
    description: "Logo uploads per brand owner per day.",
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
