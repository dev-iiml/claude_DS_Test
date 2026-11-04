import { BRAND_TERMS_VERSION } from "@/modules/brand-orgs/domain";

import type { Database } from "../create-db";
import { authIdentities, brandOrgClaims, brandOrgMembers, brandOrgReviews, brandOrgs, users } from "../schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Stage 19 demo: one FICTIONAL verified brand organisation (reserved `.test`
 * email domain, `.example` website, a CIN with the non-existent state code
 * "ZZ"), its owner account, and its approved claim on the fictional
 * "Wanderlane Luggage" directory entry — verified by one partnerships admin and
 * approved by another. No public passport is seeded: creators publish their
 * own (it needs a connected account and its own consent).
 */
const uuid = (prefix: string, n: number) => `00000000-0000-4000-${prefix}-${String(n).padStart(12, "0")}`;
export const passportDemoIds = {
  org: (n: number) => uuid("8010", n),
  member: (n: number) => uuid("8011", n),
  claim: (n: number) => uuid("8012", n),
  identity: (n: number) => uuid("8001", n),
  user: (n: number) => uuid("8002", n),
};

export const DEMO_BRAND_MEMBER = { n: 201, email: "owner@wanderlane.test" } as const;

const SEED_AT = new Date("2026-10-25T06:30:00.000Z");

export async function seedPassportDemo(
  tx: Tx,
  input: { passwordHash: string; verifier: string; approver: string; directoryId: string },
) {
  const orgId = passportDemoIds.org(1);
  const userId = passportDemoIds.user(DEMO_BRAND_MEMBER.n);
  await tx
    .insert(authIdentities)
    .values({
      id: passportDemoIds.identity(DEMO_BRAND_MEMBER.n),
      email: DEMO_BRAND_MEMBER.email,
      passwordHash: input.passwordHash,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoNothing();
  await tx
    .insert(users)
    .values({
      id: userId,
      authUserId: passportDemoIds.identity(DEMO_BRAND_MEMBER.n),
      email: DEMO_BRAND_MEMBER.email,
      role: "brand_member",
      status: "active",
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoNothing();
  const [created] = await tx
    .insert(brandOrgs)
    .values({
      id: orgId,
      legalName: "Wanderlane Luggage Private Limited",
      orgType: "brand",
      website: "https://wanderlane.example",
      emailDomain: "wanderlane.test",
      identifierType: "cin",
      identifierValue: "U74999ZZ2020PTC000123",
      status: "verified",
      lookupLegalName: "Wanderlane Luggage Private Limited",
      lookupStatus: "active",
      lookupIncorporatedOn: "2020-03-14",
      lookupProvider: "mock",
      lookupAt: SEED_AT,
      verifiedBy: input.verifier,
      verifiedAt: SEED_AT,
      approvedBy: input.approver,
      approvedAt: SEED_AT,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoNothing()
    .returning({ id: brandOrgs.id });
  if (!created) return;
  await tx.insert(brandOrgMembers).values({
    id: passportDemoIds.member(1),
    orgId,
    userId,
    orgRole: "owner",
    termsVersion: BRAND_TERMS_VERSION,
    termsAcceptedAt: SEED_AT,
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  });
  await tx.insert(brandOrgClaims).values({
    id: passportDemoIds.claim(1),
    orgId,
    directoryId: input.directoryId,
    status: "approved",
    verifiedBy: input.verifier,
    approvedBy: input.approver,
    createdBy: userId,
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  });
  await tx.insert(brandOrgReviews).values([
    { orgId, target: "org", targetId: orgId, action: "verify", actorId: input.verifier, createdAt: SEED_AT },
    { orgId, target: "org", targetId: orgId, action: "approve", actorId: input.approver, createdAt: SEED_AT },
    {
      orgId,
      target: "claim",
      targetId: passportDemoIds.claim(1),
      action: "verify",
      actorId: input.verifier,
      createdAt: SEED_AT,
    },
    {
      orgId,
      target: "claim",
      targetId: passportDemoIds.claim(1),
      action: "approve",
      actorId: input.approver,
      createdAt: SEED_AT,
    },
  ]);
}
