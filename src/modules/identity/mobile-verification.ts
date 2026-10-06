import { randomInt, randomUUID } from "node:crypto";

import { and, count, desc, eq, gt, isNotNull, ne } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { isUniqueViolation } from "@/db/errors";
import { mobileVerifications, users } from "@/db/schema";
import { callProvider, recordAuditEvent } from "@/modules/audit";
import { MOCK_OTP_CODE } from "@/providers/notification/mock-notification-provider";
import type { NotificationProvider } from "@/providers/notification/types";

import { sha256Hex } from "./auth/tokens";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
} from "./verification-domain";

/**
 * Mobile ownership verification by OTP. Required before any identity lookup
 * keyed on the mobile number — otherwise anyone could look up someone else.
 *
 * Only `sha256(challengeId:code)` is stored. In mock mode the code is the
 * fixed demo value so nothing sensitive ever needs to be logged.
 */
export interface MobileVerificationDeps {
  db: Database;
  notifications: NotificationProvider;
  now?: () => Date;
}

const clock = (d: MobileVerificationDeps) => (d.now ? d.now() : new Date());

/** Normalises an Indian mobile ("98765 43210", "+91-98765-43210", "098…") to E.164. */
export function normaliseIndianMobile(raw: string): string | null {
  let digits = raw.replace(/[\s()-]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? `+91${digits}` : null;
}

export function maskMobile(e164: string): string {
  return `${e164.slice(0, 3)} ••••• ${e164.slice(-5)}`;
}

function codeHash(challengeId: string, code: string) {
  return sha256Hex(`${challengeId}:${code}`);
}

function generateCode(notifications: NotificationProvider) {
  if (notifications.descriptor.mode === "mock") return MOCK_OTP_CODE;
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

export type RequestOtpResult =
  | { ok: true; challengeId: string; resendAfterSeconds: number; mockCode: string | null }
  | { ok: false; reason: "invalid_mobile" | "mobile_in_use" | "too_soon" | "too_many" };

export async function requestMobileOtp(
  deps: MobileVerificationDeps,
  input: { userId: string; mobile: string },
): Promise<RequestOtpResult> {
  const mobile = normaliseIndianMobile(input.mobile);
  if (!mobile) return { ok: false, reason: "invalid_mobile" };
  const now = clock(deps);

  const [taken] = await deps.db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.mobile, mobile), isNotNull(users.mobileVerifiedAt), ne(users.id, input.userId)));
  if ((taken?.n ?? 0) > 0) return { ok: false, reason: "mobile_in_use" };

  const recent = await deps.db
    .select({ createdAt: mobileVerifications.createdAt })
    .from(mobileVerifications)
    .where(
      and(
        eq(mobileVerifications.userId, input.userId),
        gt(mobileVerifications.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    )
    .orderBy(desc(mobileVerifications.createdAt));
  if (recent.length >= OTP_MAX_SENDS_PER_HOUR) return { ok: false, reason: "too_many" };
  const last = recent[0];
  if (last && now.getTime() - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000) {
    return { ok: false, reason: "too_soon" };
  }

  const challengeId = randomUUID();
  const code = generateCode(deps.notifications);
  await deps.db.insert(mobileVerifications).values({
    id: challengeId,
    userId: input.userId,
    mobile,
    codeHash: codeHash(challengeId, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
    createdAt: now,
  });

  await callProvider(
    deps.db,
    { userId: input.userId, provider: deps.notifications.descriptor, operation: "send_otp_sms" },
    () => deps.notifications.sendOtpSms({ to: mobile, code, purpose: "mobile_verification" }),
    (r) => ({ outcome: "success", reference: r.reference }),
  );

  return {
    ok: true,
    challengeId,
    resendAfterSeconds: OTP_RESEND_SECONDS,
    mockCode: deps.notifications.descriptor.mode === "mock" ? MOCK_OTP_CODE : null,
  };
}

export type VerifyOtpResult =
  | { ok: true; mobile: string }
  | { ok: false; reason: "not_found" | "expired" | "locked" | "invalid_code" | "mobile_in_use"; attemptsLeft?: number };

export async function verifyMobileOtp(
  deps: MobileVerificationDeps,
  input: { userId: string; challengeId: string; code: string },
): Promise<VerifyOtpResult> {
  const now = clock(deps);
  try {
    return await deps.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(mobileVerifications)
        .where(and(eq(mobileVerifications.id, input.challengeId), eq(mobileVerifications.userId, input.userId)))
        .for("update")
        .limit(1);

      if (!challenge || challenge.verifiedAt) return { ok: false, reason: "not_found" } as const;
      if (challenge.expiresAt <= now) return { ok: false, reason: "expired" } as const;
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked" } as const;

      const code = input.code.replace(/\s/g, "");
      if (!/^[0-9]{6}$/.test(code) || codeHash(challenge.id, code) !== challenge.codeHash) {
        const attempts = challenge.attempts + 1;
        await tx.update(mobileVerifications).set({ attempts }).where(eq(mobileVerifications.id, challenge.id));
        return attempts >= OTP_MAX_ATTEMPTS
          ? ({ ok: false, reason: "locked" } as const)
          : ({ ok: false, reason: "invalid_code", attemptsLeft: OTP_MAX_ATTEMPTS - attempts } as const);
      }

      const [taken] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.mobile, challenge.mobile), isNotNull(users.mobileVerifiedAt), ne(users.id, input.userId)));
      if ((taken?.n ?? 0) > 0) return { ok: false, reason: "mobile_in_use" } as const;

      await tx.update(mobileVerifications).set({ verifiedAt: now }).where(eq(mobileVerifications.id, challenge.id));
      await tx.update(users).set({ mobile: challenge.mobile, mobileVerifiedAt: now }).where(eq(users.id, input.userId));
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.userId,
        eventType: "identity.mobile_verified",
        entityType: "user",
        entityId: input.userId,
      });
      return { ok: true, mobile: challenge.mobile } as const;
    });
  } catch (error) {
    // Lost a race with another account verifying the same number.
    if (isUniqueViolation(error, "users_verified_mobile_key")) return { ok: false, reason: "mobile_in_use" };
    throw error;
  }
}

export async function getVerifiedMobile(db: Database, userId: string): Promise<string | null> {
  const [u] = await db
    .select({ mobile: users.mobile, verifiedAt: users.mobileVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.verifiedAt && u.mobile ? u.mobile : null;
}
