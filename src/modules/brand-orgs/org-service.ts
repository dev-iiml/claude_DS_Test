import { randomBytes } from "node:crypto";

import { and, asc, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brandOrgInvites, brandOrgMembers, brandOrgs, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { sha256Hex } from "@/modules/identity/auth/tokens";
import { signUpBrandMember, type AuthDeps } from "@/modules/identity/auth/auth-service";
import { evaluatePassword } from "@/modules/identity/auth/password-policy";
import type { NotificationProvider } from "@/providers/notification/types";

import { BRAND_TERMS_VERSION, emailDomain, INVITE_TTL_DAYS, type MemberRole, type OrgStatus } from "./domain";
import { BrandOrgError } from "./errors";

/**
 * Organisation membership (Stage 19). A brand member belongs to exactly one
 * organisation. Owners invite colleagues from the same email domain (a hashed
 * one-time link) and remove members. Members accept the brand terms before
 * they can unlock passports.
 */

export interface Membership {
  memberId: string;
  orgId: string;
  orgRole: MemberRole;
  orgStatus: OrgStatus;
  orgName: string;
  orgType: "brand" | "agency";
  termsAccepted: boolean;
}

export async function getMembership(db: DbExecutor, userId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ m: brandOrgMembers, o: brandOrgs })
    .from(brandOrgMembers)
    .innerJoin(brandOrgs, eq(brandOrgs.id, brandOrgMembers.orgId))
    .where(and(eq(brandOrgMembers.userId, userId), eq(brandOrgMembers.status, "active")))
    .limit(1);
  if (!row) return null;
  return {
    memberId: row.m.id,
    orgId: row.o.id,
    orgRole: row.m.orgRole,
    orgStatus: row.o.status,
    orgName: row.o.legalName,
    orgType: row.o.orgType,
    termsAccepted: row.m.termsVersion === BRAND_TERMS_VERSION,
  };
}

export async function acceptBrandTerms(db: Database, input: { userId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const m = await getMembership(db, input.userId);
  if (!m) throw new BrandOrgError("forbidden");
  await db.transaction(async (tx) => {
    await tx
      .update(brandOrgMembers)
      .set({ termsVersion: BRAND_TERMS_VERSION, termsAcceptedAt: now })
      .where(eq(brandOrgMembers.id, m.memberId));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_org.terms_accepted",
      entityType: "brand_org",
      entityId: m.orgId,
      metadata: { version: BRAND_TERMS_VERSION },
    });
  });
}

export async function getOrgProfile(db: DbExecutor, orgId: string) {
  const [o] = await db.select().from(brandOrgs).where(eq(brandOrgs.id, orgId));
  if (!o) return null;
  // Never the GSTIN fingerprint: only whether one was given.
  return {
    id: o.id,
    legalName: o.legalName,
    orgType: o.orgType,
    website: o.website,
    emailDomain: o.emailDomain,
    identifierType: o.identifierType,
    identifierValue: o.identifierValue,
    gstinGiven: o.gstinFingerprint !== null,
    status: o.status,
    createdAt: o.createdAt,
  };
}

export async function listMembers(db: DbExecutor, orgId: string) {
  return db
    .select({
      id: brandOrgMembers.id,
      userId: brandOrgMembers.userId,
      email: users.email,
      orgRole: brandOrgMembers.orgRole,
      status: brandOrgMembers.status,
      termsAccepted: brandOrgMembers.termsVersion,
      createdAt: brandOrgMembers.createdAt,
    })
    .from(brandOrgMembers)
    .innerJoin(users, eq(users.id, brandOrgMembers.userId))
    .where(and(eq(brandOrgMembers.orgId, orgId), eq(brandOrgMembers.status, "active")))
    .orderBy(asc(brandOrgMembers.createdAt));
}

async function requireOwner(db: DbExecutor, userId: string) {
  const m = await getMembership(db, userId);
  if (!m || m.orgRole !== "owner") throw new BrandOrgError("forbidden", "Only an owner can manage members.");
  return m;
}

export async function listInvites(db: DbExecutor, orgId: string, now = new Date()) {
  return db
    .select({ id: brandOrgInvites.id, email: brandOrgInvites.email, expiresAt: brandOrgInvites.expiresAt })
    .from(brandOrgInvites)
    .where(
      and(
        eq(brandOrgInvites.orgId, orgId),
        isNull(brandOrgInvites.acceptedAt),
        isNull(brandOrgInvites.revokedAt),
        gt(brandOrgInvites.expiresAt, now),
      ),
    );
}

/**
 * Invites a colleague. The email must be on the organisation's domain. Returns the link only when notifications
 * run in mock mode (so the owner can pass it on); otherwise it's emailed and never shown or stored.
 */
export async function inviteMember(
  deps: { db: Database; notifications: NotificationProvider; appUrl: string; now?: Date },
  input: { userId: string; email: string },
): Promise<{ inviteId: string; mockLink: string | null }> {
  const now = deps.now ?? new Date();
  const owner = await requireOwner(deps.db, input.userId);
  const org = await getOrgProfile(deps.db, owner.orgId);
  const email = input.email.trim().toLowerCase();
  const domain = emailDomain(email);
  if (!domain || !org || (domain !== org.emailDomain && !domain.endsWith(`.${org.emailDomain}`)))
    throw new BrandOrgError("invalid", `Invite someone with an @${org?.emailDomain ?? "your-domain"} email.`);
  const [taken] = await deps.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken) throw new BrandOrgError("email_taken", "Someone with this email already has a CreatorCo account.");
  const token = randomBytes(32).toString("base64url");
  const [row] = await deps.db
    .insert(brandOrgInvites)
    .values({
      orgId: owner.orgId,
      email,
      tokenHash: sha256Hex(`brand-invite:${token}`),
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000),
      createdBy: input.userId,
    })
    .returning({ id: brandOrgInvites.id });
  const link = `${deps.appUrl.replace(/\/$/, "")}/brands/join/${token}`;
  await deps.notifications.sendInviteEmail({ to: email, link, organisation: owner.orgName });
  await recordAuditEvent(deps.db, {
    actorType: "user",
    actorId: input.userId,
    eventType: "brand_org.member_invited",
    entityType: "brand_org",
    entityId: owner.orgId,
  });
  return { inviteId: row!.id, mockLink: deps.notifications.descriptor.mode === "mock" ? link : null };
}

export async function inviteFor(db: DbExecutor, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({ invite: brandOrgInvites, orgName: brandOrgs.legalName, orgStatus: brandOrgs.status })
    .from(brandOrgInvites)
    .innerJoin(brandOrgs, eq(brandOrgs.id, brandOrgInvites.orgId))
    .where(
      and(
        eq(brandOrgInvites.tokenHash, sha256Hex(`brand-invite:${token}`)),
        isNull(brandOrgInvites.acceptedAt),
        isNull(brandOrgInvites.revokedAt),
        gt(brandOrgInvites.expiresAt, now),
      ),
    );
  if (!row || row.orgStatus === "rejected" || row.orgStatus === "suspended") return null;
  return { id: row.invite.id, orgId: row.invite.orgId, email: row.invite.email, orgName: row.orgName };
}

/** The invitee sets a password; the account joins the organisation as a member (terms accepted on this form). */
export async function acceptInvite(
  deps: { auth: AuthDeps; now?: Date },
  input: { token: string; password: string; acceptTerms: boolean },
) {
  const now = deps.now ?? new Date();
  if (!input.acceptTerms) throw new BrandOrgError("terms_required", "Accept the brand terms to continue.");
  if (!evaluatePassword(input.password).valid)
    throw new BrandOrgError(
      "invalid",
      "Use 8+ characters with upper- and lower-case letters, a number and a special character.",
    );
  const invite = await inviteFor(deps.auth.db, input.token, now);
  if (!invite) throw new BrandOrgError("code_expired", "This invitation has expired or was already used.");
  const result = await signUpBrandMember(deps.auth, {
    email: invite.email,
    password: input.password,
    onCreated: async (tx, userId) => {
      const [locked] = await tx.select().from(brandOrgInvites).where(eq(brandOrgInvites.id, invite.id)).for("update");
      if (!locked || locked.acceptedAt || locked.revokedAt) throw new BrandOrgError("code_expired");
      await tx.update(brandOrgInvites).set({ acceptedAt: now }).where(eq(brandOrgInvites.id, invite.id));
      await tx.insert(brandOrgMembers).values({
        orgId: invite.orgId,
        userId,
        orgRole: "member",
        termsVersion: BRAND_TERMS_VERSION,
        termsAcceptedAt: now,
        invitedBy: locked.createdBy,
      });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: userId,
        eventType: "brand_org.member_joined",
        entityType: "brand_org",
        entityId: invite.orgId,
      });
    },
  });
  if (!result.ok) throw new BrandOrgError("email_taken");
  return result;
}

export async function removeMember(db: Database, input: { userId: string; memberId: string }) {
  const owner = await requireOwner(db, input.userId);
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(brandOrgMembers)
      .where(and(eq(brandOrgMembers.id, input.memberId), eq(brandOrgMembers.orgId, owner.orgId)))
      .for("update");
    if (!m || m.status !== "active") throw new BrandOrgError("not_found");
    if (m.userId === input.userId) throw new BrandOrgError("invalid", "You can't remove yourself.");
    await tx.update(brandOrgMembers).set({ status: "removed" }).where(eq(brandOrgMembers.id, m.id));
    // A removed member's account can no longer sign in to anything.
    await tx.update(users).set({ status: "deactivated" }).where(eq(users.id, m.userId));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_org.member_removed",
      entityType: "brand_org",
      entityId: owner.orgId,
    });
  });
}

export async function revokeInvite(db: Database, input: { userId: string; inviteId: string; now?: Date }) {
  const owner = await requireOwner(db, input.userId);
  await db
    .update(brandOrgInvites)
    .set({ revokedAt: input.now ?? new Date() })
    .where(
      and(
        eq(brandOrgInvites.id, input.inviteId),
        eq(brandOrgInvites.orgId, owner.orgId),
        isNull(brandOrgInvites.acceptedAt),
      ),
    );
}
