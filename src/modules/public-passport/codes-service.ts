import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brandOrgs, passportAccessCodes, passportAccessLog, publicPassports } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { restrictedTextKinds } from "@/lib/restricted-text";
import { recordEvent } from "@/modules/analytics";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import {
  CODE_EXPIRY_DAYS,
  CODE_FAILURE_LIMIT,
  CODE_FAILURE_WINDOW_MINUTES,
  CODE_LOCKOUT_MINUTES,
  CODE_MAX_USES_LIMIT,
  UNLOCK_TTL_HOURS,
  type CodeExpiryDays,
} from "./domain";
import { PassportError } from "./errors";
import { accessCodeMatches, encodeUnlock, generateAccessCode, hashAccessCode, normaliseAccessCode } from "./keys";
import { ensurePassport } from "./settings-service";

/**
 * Creator access codes (Stage 19). A code is shown once; only its SHA-256
 * hash and last four characters are kept. Redeeming a code gives a signed
 * cookie for that passport only, for at most 24 hours (or until the code
 * expires). Wrong codes count against the passport: after 10 in 15 minutes,
 * code entry is locked for 15 minutes and the creator sees it in the log.
 */

/** India day and hour for the access log (no finer timestamp is shown or needed). */
export function indiaDayHour(now: Date): { day: string; hour: number } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { day: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

export function checkLabel(raw: string): string {
  const label = raw.trim();
  if (label.length < 1 || label.length > 60)
    throw new PassportError("invalid", "Give the code a short label (up to 60 characters).");
  if (restrictedTextKinds(label).length)
    throw new PassportError("invalid", "Leave out phone numbers, email addresses and ID numbers.");
  return label;
}

export async function createAccessCode(
  db: Database,
  input: {
    userId: string;
    label: string;
    expiresInDays: CodeExpiryDays;
    maxUses?: number | null;
    /** Scope the code to one verified organisation (the Access flow). */
    orgId?: string | null;
    now?: Date;
  },
): Promise<{ id: string; code: string; display: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const label = checkLabel(input.label);
  if (!(CODE_EXPIRY_DAYS as readonly number[]).includes(input.expiresInDays))
    throw new PassportError("invalid", "Choose 7, 30 or 90 days.");
  if (
    input.maxUses != null &&
    (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > CODE_MAX_USES_LIMIT)
  )
    throw new PassportError("invalid", `Use a limit from 1 to ${CODE_MAX_USES_LIMIT}, or none.`);
  if (!(await hasValidConsent(db, input.userId, CONSENT_KEYS.passportUnlock, now)))
    throw new PassportError("consent_required", "Turn on Passport unlocking first.");
  if (input.orgId) {
    const [org] = await db.select({ status: brandOrgs.status }).from(brandOrgs).where(eq(brandOrgs.id, input.orgId));
    if (org?.status !== "verified") throw new PassportError("invalid", "That organisation isn't verified.");
  }
  const passport = await ensurePassport(db, input.userId);
  const generated = generateAccessCode();
  const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(passportAccessCodes)
      .values({
        passportId: passport.id,
        label,
        codeHash: generated.hash,
        codeHint: generated.hint,
        orgId: input.orgId ?? null,
        expiresAt,
        maxUses: input.maxUses ?? null,
      })
      .returning({ id: passportAccessCodes.id });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "public_passport.code_created",
      entityType: "passport_access_code",
      entityId: row!.id,
      metadata: { days: input.expiresInDays, scoped: Boolean(input.orgId) },
    });
    await recordEvent(tx, {
      event: "passport_code_created",
      userId: input.userId,
      props: { scoped: Boolean(input.orgId) },
      now,
    });
    return row!.id;
  });
  return { id, code: generated.code, display: generated.display, expiresAt };
}

export type CodeStatus = "active" | "expired" | "used_up" | "revoked";

export function codeStatus(
  c: { revokedAt: Date | null; expiresAt: Date; maxUses: number | null; uses: number },
  now: Date,
): CodeStatus {
  if (c.revokedAt) return "revoked";
  if (c.expiresAt.getTime() <= now.getTime()) return "expired";
  if (c.maxUses !== null && c.uses >= c.maxUses) return "used_up";
  return "active";
}

export async function listAccessCodes(db: Database, userId: string, now = new Date()) {
  const passport = await ensurePassport(db, userId);
  const rows = await db
    .select({ c: passportAccessCodes, orgName: brandOrgs.legalName })
    .from(passportAccessCodes)
    .leftJoin(brandOrgs, eq(brandOrgs.id, passportAccessCodes.orgId))
    .where(eq(passportAccessCodes.passportId, passport.id))
    .orderBy(desc(passportAccessCodes.createdAt));
  return rows.map(({ c, orgName }) => ({
    id: c.id,
    label: c.label,
    hint: c.codeHint,
    orgName,
    expiresAt: c.expiresAt,
    maxUses: c.maxUses,
    uses: c.uses,
    lastUsedAt: c.lastUsedAt,
    createdAt: c.createdAt,
    status: codeStatus(c, now),
  }));
}

export async function revokeAccessCode(db: Database, input: { userId: string; codeId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const passport = await ensurePassport(db, input.userId);
  await db.transaction(async (tx) => {
    const [code] = await tx
      .select()
      .from(passportAccessCodes)
      .where(and(eq(passportAccessCodes.id, input.codeId), eq(passportAccessCodes.passportId, passport.id)))
      .for("update");
    if (!code) throw new PassportError("not_found");
    if (code.revokedAt) return;
    await tx.update(passportAccessCodes).set({ revokedAt: now }).where(eq(passportAccessCodes.id, code.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "public_passport.code_revoked",
      entityType: "passport_access_code",
      entityId: code.id,
    });
  });
}

/** Withdrawal of `passport_unlock`: every code on the creator's passport stops working at once. */
export async function revokeAllCodes(tx: DbExecutor, input: { userId: string; now: Date }) {
  const rows = await tx
    .update(passportAccessCodes)
    .set({ revokedAt: input.now })
    .where(
      and(
        isNull(passportAccessCodes.revokedAt),
        sql`${passportAccessCodes.passportId} in (select id from public_passports where user_id = ${input.userId})`,
      ),
    )
    .returning({ id: passportAccessCodes.id });
  return rows.length;
}

// ── Redeeming ───────────────────────────────────────────────────────────────

/** The unverified name/company a viewer may give: short, and dropped if it looks like a phone, email or ID number. */
function cleanViewerText(v: string | null | undefined, max: number): string | null {
  const t = v?.trim().slice(0, max) || null;
  return t && restrictedTextKinds(t).length === 0 ? t : null;
}

export type RedeemResult =
  | { ok: true; codeId: string; cookieValue: string; expiresAt: Date }
  | { ok: false; reason: "wrong" | "locked_out" | "expired" | "unavailable" };

/** Whether this passport currently accepts code unlocks at all. */
async function codeUnlocksOpen(db: DbExecutor, userId: string, now: Date) {
  return (
    (await isFeatureEnabled(db, "passport_code_unlocks")) &&
    (await hasValidConsent(db, userId, CONSENT_KEYS.passportUnlock, now))
  );
}

/**
 * Checks a typed code against a published passport. The comparison is on a
 * hash in constant time; wrong attempts count towards the passport's lockout.
 * `viewerOrgId`: a code scoped to an organisation works only for its members.
 */
export async function redeemAccessCode(
  db: Database,
  input: {
    passportId: string;
    code: string;
    viewerName?: string | null;
    viewerCompany?: string | null;
    viewerOrgId?: string | null;
    ipPseudonym: string | null;
    now?: Date;
  },
): Promise<RedeemResult> {
  const now = input.now ?? new Date();
  const result = await db.transaction(async (tx): Promise<RedeemResult> => {
    const [passport] = await tx
      .select()
      .from(publicPassports)
      .where(eq(publicPassports.id, input.passportId))
      .for("update");
    if (!passport || passport.status !== "published") return { ok: false, reason: "unavailable" };
    if (!(await codeUnlocksOpen(tx, passport.userId, now))) return { ok: false, reason: "unavailable" };

    const normalised = normaliseAccessCode(input.code);
    const [candidate] = normalised
      ? await tx
          .select()
          .from(passportAccessCodes)
          .where(
            and(
              eq(passportAccessCodes.codeHash, hashAccessCode(normalised)),
              eq(passportAccessCodes.passportId, passport.id),
            ),
          )
          .for("update")
      : [];
    const matched =
      candidate &&
      normalised &&
      accessCodeMatches(normalised, candidate.codeHash) &&
      (!candidate.orgId || (candidate.orgId === input.viewerOrgId && (await orgVerified(tx, candidate.orgId))))
        ? candidate
        : null;

    if (!matched) {
      // Wrong codes are counted per passport so the creator hears about a burst of them (an access-log entry, once per
      // lockout window). The lockout itself is per network (the `passport.code_attempt` rate limit): a stranger's
      // wrong guesses never stop the people the creator gave a real code to.
      const windowStart = passport.codeFailuresSince;
      const fresh = !windowStart || now.getTime() - windowStart.getTime() > CODE_FAILURE_WINDOW_MINUTES * 60_000;
      const failures = fresh ? 1 : passport.codeFailures + 1;
      const alreadyNoticed = passport.codeLockedUntil !== null && passport.codeLockedUntil.getTime() > now.getTime();
      const notice = failures >= CODE_FAILURE_LIMIT && !alreadyNoticed;
      await tx
        .update(publicPassports)
        .set({
          codeFailures: notice ? 0 : failures,
          codeFailuresSince: notice ? null : fresh ? now : windowStart,
          codeLockedUntil: notice ? new Date(now.getTime() + CODE_LOCKOUT_MINUTES * 60_000) : passport.codeLockedUntil,
        })
        .where(eq(publicPassports.id, passport.id));
      if (notice) {
        await tx
          .insert(passportAccessLog)
          .values({ passportId: passport.id, kind: "lockout", ipPseudonym: input.ipPseudonym, ...indiaDayHour(now) });
        await recordAuditEvent(tx, {
          actorType: "system",
          eventType: "public_passport.code_failures_notified",
          entityType: "public_passport",
          entityId: passport.id,
        });
      }
      return { ok: false, reason: "wrong" };
    }
    if (codeStatus(matched, now) !== "active") return { ok: false, reason: "expired" };

    await tx
      .update(passportAccessCodes)
      .set({ uses: matched.uses + 1, lastUsedAt: now })
      .where(eq(passportAccessCodes.id, matched.id));
    await tx
      .update(publicPassports)
      .set({ codeFailures: 0, codeFailuresSince: null })
      .where(eq(publicPassports.id, passport.id));
    await tx.insert(passportAccessLog).values({
      passportId: passport.id,
      kind: "code",
      codeId: matched.id,
      codeLabel: matched.label,
      orgId: matched.orgId,
      viewerName: cleanViewerText(input.viewerName, 60),
      viewerCompany: cleanViewerText(input.viewerCompany, 80),
      ipPseudonym: input.ipPseudonym,
      ...indiaDayHour(now),
    });
    const expiresAt = new Date(Math.min(now.getTime() + UNLOCK_TTL_HOURS * 3_600_000, matched.expiresAt.getTime()));
    return { ok: true, codeId: matched.id, cookieValue: encodeUnlock(passport.id, matched.id, expiresAt), expiresAt };
  });
  await recordEvent(db, {
    event: "passport_unlock_attempted",
    props: { result: result.ok ? "success" : result.reason === "unavailable" ? "expired" : result.reason },
    now,
  });
  return result;
}

async function orgVerified(db: DbExecutor, orgId: string) {
  const [org] = await db.select({ status: brandOrgs.status }).from(brandOrgs).where(eq(brandOrgs.id, orgId));
  return org?.status === "verified";
}

/**
 * A code-based unlock is still valid: the code is active and unlocking is still allowed. A code scoped to an
 * organisation stays valid only for a member of that organisation while it is verified (`viewerOrgId`).
 */
export async function codeUnlockValid(
  db: DbExecutor,
  input: { passportId: string; userId: string; codeId: string; now: Date; viewerOrgId?: string | null },
) {
  const [code] = await db
    .select()
    .from(passportAccessCodes)
    .where(
      and(
        eq(passportAccessCodes.id, input.codeId),
        eq(passportAccessCodes.passportId, input.passportId),
        isNull(passportAccessCodes.revokedAt),
        gt(passportAccessCodes.expiresAt, input.now),
      ),
    );
  if (!code) return false;
  if (code.orgId && (code.orgId !== input.viewerOrgId || !(await orgVerified(db, code.orgId)))) return false;
  return codeUnlocksOpen(db, input.userId, input.now);
}

export async function listAccessLog(db: Database, userId: string, limit = 100) {
  const passport = await ensurePassport(db, userId);
  const rows = await db
    .select({ l: passportAccessLog, orgName: brandOrgs.legalName })
    .from(passportAccessLog)
    .leftJoin(brandOrgs, eq(brandOrgs.id, passportAccessLog.orgId))
    .where(eq(passportAccessLog.passportId, passport.id))
    .orderBy(desc(passportAccessLog.createdAt))
    .limit(limit);
  return rows.map(({ l, orgName }) => ({
    id: l.id,
    kind: l.kind,
    codeLabel: l.codeLabel,
    orgName,
    // Verified: a brand unlock, or a code the creator scoped to an organisation (only its verified members can use it).
    orgVerified: l.kind === "brand" || (l.kind === "code" && l.orgId !== null),
    viewerName: l.viewerName,
    viewerCompany: l.viewerCompany,
    day: l.day,
    hour: l.hour,
  }));
}
