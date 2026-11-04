import { and, isNotNull, lt, or } from "drizzle-orm";

import { authLoginAttempts, authSessions, mobileVerifications } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

/**
 * Data minimisation for short-lived security records (Stage 16). These exist
 * only to run sign-in lockout, sessions and code verification; once that use
 * has passed they are deleted. Sign-in records are kept 180 days, in line
 * with CERT-In's 2022 direction to keep ICT system logs for 180 days; both
 * periods are pending confirmation in the retention schedule
 * (docs/DATA_CLASSIFICATION.md).
 */
export const AUTH_RECORD_RETENTION_DAYS = {
  /** Lockout looks back 15 minutes; kept as security logs. */
  loginAttempts: 180,
  /** After a session expired or was revoked; kept as security logs. */
  endedSessions: 180,
  /** Verification codes (the verified number itself lives on the user). */
  mobileVerifications: 30,
} as const;

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export async function purgeAuthRecords(db: DbExecutor, now = new Date()) {
  const r = AUTH_RECORD_RETENTION_DAYS;
  const attempts = await db
    .delete(authLoginAttempts)
    .where(lt(authLoginAttempts.createdAt, daysBefore(now, r.loginAttempts)))
    .returning({ id: authLoginAttempts.id });
  const sessionCutoff = daysBefore(now, r.endedSessions);
  const sessions = await db
    .delete(authSessions)
    .where(
      or(
        lt(authSessions.expiresAt, sessionCutoff),
        and(isNotNull(authSessions.revokedAt), lt(authSessions.revokedAt, sessionCutoff)),
      ),
    )
    .returning({ id: authSessions.id });
  const codes = await db
    .delete(mobileVerifications)
    .where(lt(mobileVerifications.createdAt, daysBefore(now, r.mobileVerifications)))
    .returning({ id: mobileVerifications.id });
  return { login_attempts: attempts.length, sessions: sessions.length, mobile_verifications: codes.length };
}
