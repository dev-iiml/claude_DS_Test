import { randomInt, randomUUID } from "node:crypto";

import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { isUniqueViolation } from "@/db/errors";
import type { Database } from "@/db/create-db";
import { brandEmailChallenges, brandOrgMembers, brandOrgs, users } from "@/db/schema";
import { restrictedTextKinds } from "@/lib/restricted-text";
import { recordEvent } from "@/modules/analytics";
import { callProvider, recordAuditEvent } from "@/modules/audit";
import { isValidGstin, normaliseGstin } from "@/modules/creator-profile/gstin";
import { sha256Hex } from "@/modules/identity/auth/tokens";
import { signUpBrandMember, type AuthDeps } from "@/modules/identity/auth/auth-service";
import { evaluatePassword } from "@/modules/identity/auth/password-policy";
import { gstinFingerprint } from "@/modules/public-passport/keys";
import { MOCK_OTP_CODE } from "@/providers/notification/mock-notification-provider";
import type { NotificationProvider } from "@/providers/notification/types";

import {
  BRAND_TERMS_VERSION,
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_TTL_MINUTES,
  IDENTIFIER_TYPES,
  ORG_TYPES,
  emailDomain,
  isFreeMailDomain,
  isValidIdentifier,
  normaliseIdentifier,
  websiteHost,
} from "./domain";
import { BrandOrgError } from "./errors";

/**
 * Brand and agency sign-up (Stage 19): a work email proven by a one-time code
 * (free-mail domains refused), then the organisation's details with a public
 * MCA identifier. GSTIN is optional and RESTRICTED: it is validated, turned
 * into a keyed fingerprint plus state code, and never stored, logged, audited
 * or echoed back.
 */

const MAX_SENDS_PER_HOUR = 5;

function generateCode(notifications: NotificationProvider) {
  return notifications.descriptor.mode === "mock" ? MOCK_OTP_CODE : String(randomInt(0, 1_000_000)).padStart(6, "0");
}
const codeHash = (challengeId: string, code: string) => sha256Hex(`brand-email:${challengeId}:${code}`);

export async function requestBrandEmailCode(
  deps: { db: Database; notifications: NotificationProvider; now?: Date },
  input: { email: string },
): Promise<{ challengeId: string; mockCode: string | null }> {
  const now = deps.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const domain = emailDomain(email);
  if (!domain) throw new BrandOrgError("invalid", "Enter your work email address.");
  if (isFreeMailDomain(domain))
    throw new BrandOrgError("free_mail", "Use your organisation's email address, not a personal one.");
  const [taken] = await deps.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken) throw new BrandOrgError("email_taken", "An account with this email already exists. Sign in instead.");
  const [recent] = await deps.db
    .select({ n: count() })
    .from(brandEmailChallenges)
    .where(
      and(
        eq(brandEmailChallenges.email, email),
        gt(brandEmailChallenges.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  if (Number(recent?.n ?? 0) >= MAX_SENDS_PER_HOUR)
    throw new BrandOrgError("invalid", "Too many codes sent. Try again in an hour.");

  const challengeId = randomUUID();
  const code = generateCode(deps.notifications);
  await deps.db.insert(brandEmailChallenges).values({
    id: challengeId,
    email,
    codeHash: codeHash(challengeId, code),
    expiresAt: new Date(now.getTime() + EMAIL_OTP_TTL_MINUTES * 60_000),
    createdAt: now,
  });
  await callProvider(
    deps.db,
    { userId: null, provider: deps.notifications.descriptor, operation: "send_otp_email" },
    () => deps.notifications.sendOtpEmail({ to: email, code, purpose: "brand_signup" }),
    (r) => ({ outcome: "success", reference: r.reference }),
  );
  return { challengeId, mockCode: deps.notifications.descriptor.mode === "mock" ? MOCK_OTP_CODE : null };
}

/** The email a pending challenge is for (to show "we sent a code to …"). */
export async function challengeEmail(db: Database, challengeId: string, now = new Date()): Promise<string | null> {
  if (!z.uuid().safeParse(challengeId).success) return null;
  const [c] = await db
    .select({ email: brandEmailChallenges.email })
    .from(brandEmailChallenges)
    .where(
      and(
        eq(brandEmailChallenges.id, challengeId),
        gt(brandEmailChallenges.expiresAt, now),
        isNull(brandEmailChallenges.usedAt),
      ),
    );
  return c?.email ?? null;
}

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().optional(),
);

export const brandSignupSchema = z
  .object({
    challengeId: z.uuid(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code."),
    password: z.string().min(1, "Choose a password."),
    legalName: z.string().trim().min(2, "Enter the organisation's legal name.").max(120),
    orgType: z.enum(ORG_TYPES, "Choose brand or agency."),
    website: z
      .string()
      .trim()
      .max(200)
      .refine((v) => websiteHost(v) !== null && /^https?:\/\//.test(v), "Enter the website, starting with https://"),
    identifierType: z.enum(IDENTIFIER_TYPES, "Choose CIN or LLPIN."),
    identifierValue: z.string().trim().min(1, "Enter the company identifier."),
    gstin: optionalText,
    acceptTerms: z.literal(true, "Accept the brand terms to continue."),
  })
  .superRefine((v, ctx) => {
    const id = normaliseIdentifier(v.identifierType, v.identifierValue);
    if (!isValidIdentifier(v.identifierType, id))
      ctx.addIssue({
        code: "custom",
        path: ["identifierValue"],
        message:
          v.identifierType === "cin"
            ? "That doesn't look like a CIN (21 characters, e.g. U74999MH2015PTC123456)."
            : "That doesn't look like an LLPIN (e.g. AAB-1234).",
      });
    if (restrictedTextKinds(v.legalName).length)
      ctx.addIssue({ code: "custom", path: ["legalName"], message: "Enter just the legal name." });
    if (!evaluatePassword(v.password).valid)
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Use 8+ characters with upper- and lower-case letters, a number and a special character.",
      });
    if (v.gstin !== undefined && !isValidGstin(normaliseGstin(v.gstin)))
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "That GSTIN isn't valid. Leave it blank if you're not sure.",
      });
  });
export type BrandSignupInput = z.infer<typeof brandSignupSchema>;

/**
 * Verifies the email code and creates the account, the organisation (pending
 * verification) and its owner membership in one transaction, then signs in.
 */
export async function completeBrandSignup(
  deps: { auth: AuthDeps; now?: Date },
  input: BrandSignupInput,
): Promise<{ session: { token: string; expiresAt: Date }; userId: string; orgId: string }> {
  const db = deps.auth.db;
  const now = deps.now ?? new Date();
  const email = await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(brandEmailChallenges)
      .where(eq(brandEmailChallenges.id, input.challengeId))
      .for("update");
    if (!c || c.usedAt) throw new BrandOrgError("code_expired", "That code has been used. Start again.");
    if (c.expiresAt.getTime() <= now.getTime())
      throw new BrandOrgError("code_expired", "That code has expired. Start again.");
    if (c.attempts >= EMAIL_OTP_MAX_ATTEMPTS)
      throw new BrandOrgError("code_expired", "Too many wrong codes. Start again.");
    if (codeHash(c.id, input.code) !== c.codeHash) {
      await tx
        .update(brandEmailChallenges)
        .set({ attempts: c.attempts + 1 })
        .where(eq(brandEmailChallenges.id, c.id));
      return null;
    }
    await tx
      .update(brandEmailChallenges)
      .set({ verifiedAt: now, usedAt: now })
      .where(eq(brandEmailChallenges.id, c.id));
    return c.email;
  });
  if (!email) throw new BrandOrgError("code_invalid", "That code isn't right.");

  const domain = emailDomain(email)!;
  const identifierValue = normaliseIdentifier(input.identifierType, input.identifierValue);
  const gstin = input.gstin ? normaliseGstin(input.gstin) : null;
  let orgId = "";
  try {
    const result = await signUpBrandMember(deps.auth, {
      email,
      password: input.password,
      onCreated: async (tx, userId) => {
        const [org] = await tx
          .insert(brandOrgs)
          .values({
            legalName: input.legalName,
            orgType: input.orgType,
            website: input.website,
            emailDomain: domain,
            identifierType: input.identifierType,
            identifierValue,
            gstinFingerprint: gstin ? gstinFingerprint(gstin) : null,
            gstinStateCode: gstin ? gstin.slice(0, 2) : null,
          })
          .returning({ id: brandOrgs.id });
        orgId = org!.id;
        await tx.insert(brandOrgMembers).values({
          orgId,
          userId,
          orgRole: "owner",
          termsVersion: BRAND_TERMS_VERSION,
          termsAcceptedAt: now,
        });
        await recordAuditEvent(tx, {
          actorType: "user",
          actorId: userId,
          eventType: "brand_org.signed_up",
          entityType: "brand_org",
          entityId: orgId,
          metadata: { org_type: input.orgType, identifier_type: input.identifierType },
        });
        await recordEvent(tx, { event: "brand_org_signed_up", userId, props: { org_type: input.orgType }, now });
      },
    });
    if (!result.ok)
      throw new BrandOrgError("email_taken", "An account with this email already exists. Sign in instead.");
    return { session: result.session, userId: result.user.userId, orgId };
  } catch (error) {
    if (isUniqueViolation(error, "brand_orgs_identifier_key"))
      throw new BrandOrgError(
        "identifier_taken",
        "An organisation with this identifier is already on CreatorCo. Ask its owner to invite you.",
      );
    throw error;
  }
}
