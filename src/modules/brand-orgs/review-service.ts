import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  brandDirectory,
  brandOrgClaims,
  brandOrgMembers,
  brandOrgReviews,
  brandOrgs,
  brands,
  passportAccessLog,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordEvent } from "@/modules/analytics";
import { callProvider, recordAuditEvent } from "@/modules/audit";
import { platformLimit } from "@/modules/integrations/change-service";
import { resolveProvider } from "@/modules/integrations/router";

import {
  domainMatchesWebsite,
  ORG_REASON_CODES,
  type OrgReason,
  type OrgStatus,
  type ReviewAction,
  type ReviewTarget,
} from "./domain";
import { BrandOrgError } from "./errors";

/**
 * The partnerships desk's organisation review (Stage 19). Four eyes on every
 * decision that grants or removes access: one admin verifies (or proposes a
 * suspension / reinstatement), a DIFFERENT admin approves. The database
 * enforces it too (CHECKs on verifier ≠ approver). Reviewers see organisation
 * data only — never creator data, never a GSTIN (not even its fingerprint).
 */

const reasonOk = (r: string | null | undefined): r is OrgReason =>
  !!r && (ORG_REASON_CODES as readonly string[]).includes(r);

async function log(
  tx: DbExecutor,
  input: {
    orgId: string;
    target: ReviewTarget;
    targetId: string;
    action: ReviewAction;
    reason?: string | null;
    actorId: string;
  },
) {
  await tx.insert(brandOrgReviews).values({
    orgId: input.orgId,
    target: input.target,
    targetId: input.targetId,
    action: input.action,
    reasonCode: input.reason ?? null,
    actorId: input.actorId,
  });
  await recordAuditEvent(tx, {
    actorType: "user",
    actorId: input.actorId,
    eventType: `brand_org.${input.target}_${input.action}`,
    entityType: "brand_org",
    entityId: input.orgId,
    metadata: input.reason ? { reason: input.reason } : {},
  });
}

async function lockOrg(tx: DbExecutor, orgId: string) {
  const [o] = await tx.select().from(brandOrgs).where(eq(brandOrgs.id, orgId)).for("update");
  if (!o) throw new BrandOrgError("not_found");
  return o;
}

// ── Queue and detail ────────────────────────────────────────────────────────

export const ORG_QUEUE_FILTERS = [
  "to_verify",
  "to_approve",
  "pending_actions",
  "verified",
  "suspended",
  "rejected",
] as const;
export type OrgQueueFilter = (typeof ORG_QUEUE_FILTERS)[number];

export async function listOrgs(db: DbExecutor, filter: OrgQueueFilter) {
  const where =
    filter === "to_verify"
      ? and(eq(brandOrgs.status, "pending"), sql`${brandOrgs.verifiedBy} is null`)
      : filter === "to_approve"
        ? and(eq(brandOrgs.status, "pending"), sql`${brandOrgs.verifiedBy} is not null`)
        : filter === "pending_actions"
          ? sql`${brandOrgs.pendingAction} is not null`
          : eq(brandOrgs.status, filter as OrgStatus);
  const rows = await db
    .select({
      id: brandOrgs.id,
      legalName: brandOrgs.legalName,
      orgType: brandOrgs.orgType,
      status: brandOrgs.status,
      emailDomain: brandOrgs.emailDomain,
      verifiedBy: brandOrgs.verifiedBy,
      pendingAction: brandOrgs.pendingAction,
      createdAt: brandOrgs.createdAt,
    })
    .from(brandOrgs)
    .where(where)
    .orderBy(desc(brandOrgs.createdAt))
    .limit(200);
  const claims = await db
    .select({ orgId: brandOrgClaims.orgId, n: count() })
    .from(brandOrgClaims)
    .where(
      sql`${brandOrgClaims.status} in ('pending', 'verified') or ${brandOrgClaims.logoStatus} in ('pending', 'verified')`,
    )
    .groupBy(brandOrgClaims.orgId);
  return rows.map((r) => ({ ...r, openClaims: Number(claims.find((c) => c.orgId === r.id)?.n ?? 0) }));
}

/** Open claim/logo reviews across organisations (for the desk's claims list). */
export async function listOpenClaims(db: DbExecutor) {
  return db
    .select({
      id: brandOrgClaims.id,
      orgId: brandOrgClaims.orgId,
      orgName: brandOrgs.legalName,
      brandName: brandDirectory.canonicalName,
      status: brandOrgClaims.status,
      logoStatus: brandOrgClaims.logoStatus,
    })
    .from(brandOrgClaims)
    .innerJoin(brandOrgs, eq(brandOrgs.id, brandOrgClaims.orgId))
    .innerJoin(brandDirectory, eq(brandDirectory.id, brandOrgClaims.directoryId))
    .where(
      sql`${brandOrgClaims.status} in ('pending', 'verified') or ${brandOrgClaims.logoStatus} in ('pending', 'verified')`,
    )
    .orderBy(desc(brandOrgClaims.createdAt));
}

export async function getOrgForReview(db: DbExecutor, orgId: string) {
  const [o] = await db.select().from(brandOrgs).where(eq(brandOrgs.id, orgId));
  if (!o) return null;
  const [members, claims, reviews, unlocks, accessBrands] = await Promise.all([
    db
      .select({ email: users.email, orgRole: brandOrgMembers.orgRole, status: brandOrgMembers.status })
      .from(brandOrgMembers)
      .innerJoin(users, eq(users.id, brandOrgMembers.userId))
      .where(eq(brandOrgMembers.orgId, orgId)),
    db
      .select({ c: brandOrgClaims, brandName: brandDirectory.canonicalName })
      .from(brandOrgClaims)
      .innerJoin(brandDirectory, eq(brandDirectory.id, brandOrgClaims.directoryId))
      .where(eq(brandOrgClaims.orgId, orgId))
      .orderBy(desc(brandOrgClaims.createdAt)),
    db
      .select({ r: brandOrgReviews, actorEmail: users.email })
      .from(brandOrgReviews)
      .leftJoin(users, eq(users.id, brandOrgReviews.actorId))
      .where(eq(brandOrgReviews.orgId, orgId))
      .orderBy(desc(brandOrgReviews.createdAt)),
    // Unlock history: counts and dates per creator passport id — never creator content.
    db
      .select({ passportId: passportAccessLog.passportId, day: passportAccessLog.day, n: count() })
      .from(passportAccessLog)
      .where(and(eq(passportAccessLog.orgId, orgId), eq(passportAccessLog.kind, "brand")))
      .groupBy(passportAccessLog.passportId, passportAccessLog.day)
      .orderBy(desc(passportAccessLog.day))
      .limit(200),
    db.select({ id: brands.id, name: brands.name, brandOrgId: brands.brandOrgId }).from(brands).orderBy(brands.name),
  ]);
  return {
    org: {
      id: o.id,
      legalName: o.legalName,
      orgType: o.orgType,
      website: o.website,
      emailDomain: o.emailDomain,
      identifierType: o.identifierType,
      identifierValue: o.identifierValue,
      gstinGiven: o.gstinFingerprint !== null,
      gstinStateCode: o.gstinStateCode,
      status: o.status,
      verifiedBy: o.verifiedBy,
      approvedBy: o.approvedBy,
      pendingAction: o.pendingAction,
      pendingBy: o.pendingBy,
      dailyUnlockQuota: o.dailyUnlockQuota,
      createdAt: o.createdAt,
    },
    lookup: o.lookupAt
      ? {
          legalName: o.lookupLegalName,
          status: o.lookupStatus,
          incorporatedOn: o.lookupIncorporatedOn,
          at: o.lookupAt,
          nameMatches: (o.lookupLegalName ?? "").trim().toLowerCase() === o.legalName.trim().toLowerCase(),
        }
      : null,
    domainMatchesWebsite: domainMatchesWebsite(o.emailDomain, o.website),
    members,
    claims: claims.map(({ c, brandName }) => ({
      id: c.id,
      brandName,
      directoryId: c.directoryId,
      status: c.status,
      verifiedBy: c.verifiedBy,
      logoStatus: c.logoStatus,
      logoScan: c.logoScan,
      logoVerifiedBy: c.logoVerifiedBy,
    })),
    reviews: reviews.map(({ r, actorEmail }) => ({ ...r, actorEmail })),
    unlocks: unlocks.map((u) => ({ passportId: u.passportId, day: u.day, count: Number(u.n) })),
    accessBrands,
  };
}

// ── Company lookup ──────────────────────────────────────────────────────────

export async function runCompanyLookup(
  db: Database,
  input: { staffId: string; orgId: string; production: boolean; now?: Date },
) {
  const now = input.now ?? new Date();
  const [o] = await db.select().from(brandOrgs).where(eq(brandOrgs.id, input.orgId));
  if (!o) throw new BrandOrgError("not_found");
  const { provider } = await resolveProvider({ db, production: input.production }, "business_verification");
  const record = await callProvider(
    db,
    { userId: input.staffId, provider: provider.descriptor, operation: "lookup_company" },
    () => provider.lookupCompany({ identifierType: o.identifierType, identifier: o.identifierValue }),
    (r) => ({ outcome: r.found ? "success" : "not_found" }),
  );
  await db
    .update(brandOrgs)
    .set({
      lookupLegalName: record.found ? record.legalName : null,
      lookupStatus: record.found ? record.status : "not_found",
      lookupIncorporatedOn: record.incorporatedOn,
      lookupProvider: provider.descriptor.key,
      lookupAt: now,
    })
    .where(eq(brandOrgs.id, o.id));
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.staffId,
    eventType: "brand_org.lookup_run",
    entityType: "brand_org",
    entityId: o.id,
    metadata: { found: record.found },
  });
  return record;
}

// ── Organisation decisions (four eyes) ──────────────────────────────────────

export async function verifyOrg(db: Database, input: { staffId: string; orgId: string; now?: Date }) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const o = await lockOrg(tx, input.orgId);
    if (o.status !== "pending" || o.verifiedBy)
      throw new BrandOrgError("wrong_state", "This organisation isn't waiting for a first check.");
    if (!o.lookupAt) throw new BrandOrgError("invalid", "Run the company lookup first.");
    await tx.update(brandOrgs).set({ verifiedBy: input.staffId, verifiedAt: now }).where(eq(brandOrgs.id, o.id));
    await log(tx, { orgId: o.id, target: "org", targetId: o.id, action: "verify", actorId: input.staffId });
  });
}

export async function approveOrg(db: Database, input: { staffId: string; orgId: string; now?: Date }) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const o = await lockOrg(tx, input.orgId);
    if (o.status !== "pending" || !o.verifiedBy)
      throw new BrandOrgError("wrong_state", "This organisation hasn't been checked yet.");
    if (o.verifiedBy === input.staffId)
      throw new BrandOrgError("four_eyes", "A different admin has to approve the organisation you checked.");
    await tx
      .update(brandOrgs)
      .set({ status: "verified", approvedBy: input.staffId, approvedAt: now })
      .where(eq(brandOrgs.id, o.id));
    await log(tx, { orgId: o.id, target: "org", targetId: o.id, action: "approve", actorId: input.staffId });
    await recordEvent(tx, { event: "brand_org_verified", props: { org_type: o.orgType }, now });
  });
}

export async function rejectOrg(db: Database, input: { staffId: string; orgId: string; reason: string }) {
  if (!reasonOk(input.reason)) throw new BrandOrgError("invalid", "Choose a reason.");
  await db.transaction(async (tx) => {
    const o = await lockOrg(tx, input.orgId);
    if (o.status !== "pending") throw new BrandOrgError("wrong_state");
    await tx.update(brandOrgs).set({ status: "rejected" }).where(eq(brandOrgs.id, o.id));
    await log(tx, {
      orgId: o.id,
      target: "org",
      targetId: o.id,
      action: "reject",
      reason: input.reason,
      actorId: input.staffId,
    });
  });
}

/** Suspension and reinstatement: one admin proposes, a different admin approves. */
export async function proposeOrgAction(
  db: Database,
  input: { staffId: string; orgId: string; action: "suspend" | "reinstate"; reason: string },
) {
  if (!reasonOk(input.reason)) throw new BrandOrgError("invalid", "Choose a reason.");
  await db.transaction(async (tx) => {
    const o = await lockOrg(tx, input.orgId);
    const from = input.action === "suspend" ? "verified" : "suspended";
    if (o.status !== from || o.pendingAction) throw new BrandOrgError("wrong_state");
    await tx
      .update(brandOrgs)
      .set({ pendingAction: input.action, pendingBy: input.staffId })
      .where(eq(brandOrgs.id, o.id));
    await log(tx, {
      orgId: o.id,
      target: "org",
      targetId: o.id,
      action: input.action === "suspend" ? "propose_suspend" : "propose_reinstate",
      reason: input.reason,
      actorId: input.staffId,
    });
  });
}

export async function decideOrgAction(db: Database, input: { staffId: string; orgId: string; approve: boolean }) {
  await db.transaction(async (tx) => {
    const o = await lockOrg(tx, input.orgId);
    if (!o.pendingAction) throw new BrandOrgError("wrong_state");
    if (o.pendingBy === input.staffId) throw new BrandOrgError("four_eyes", "A different admin has to approve this.");
    const action = o.pendingAction as "suspend" | "reinstate";
    await tx
      .update(brandOrgs)
      .set({
        pendingAction: null,
        pendingBy: null,
        ...(input.approve ? { status: action === "suspend" ? ("suspended" as const) : ("verified" as const) } : {}),
      })
      .where(eq(brandOrgs.id, o.id));
    if (input.approve)
      await log(tx, {
        orgId: o.id,
        target: "org",
        targetId: o.id,
        action: action === "suspend" ? "approve_suspend" : "approve_reinstate",
        actorId: input.staffId,
      });
    else
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.staffId,
        eventType: "brand_org.org_proposal_declined",
        entityType: "brand_org",
        entityId: o.id,
      });
  });
}

export async function setOrgQuota(db: Database, input: { staffId: string; orgId: string; quota: number | null }) {
  const limit = await platformLimit(db, "brand_unlock_daily_quota");
  if (input.quota !== null && (!Number.isInteger(input.quota) || input.quota < 0 || input.quota > limit))
    throw new BrandOrgError("invalid", `Choose 0 to ${limit} (the /ops limit), or leave it at the default.`);
  await db.transaction(async (tx) => {
    const o = await lockOrg(tx, input.orgId);
    await tx.update(brandOrgs).set({ dailyUnlockQuota: input.quota }).where(eq(brandOrgs.id, o.id));
    await log(tx, { orgId: o.id, target: "org", targetId: o.id, action: "set_quota", actorId: input.staffId });
  });
}

/** Links an Access sample brand to this verified organisation (enables the Access-flow passport prompt). */
export async function linkAccessBrand(db: Database, input: { staffId: string; orgId: string; brandId: string | null }) {
  await db.transaction(async (tx) => {
    const o = await lockOrg(tx, input.orgId);
    if (o.status !== "verified") throw new BrandOrgError("not_verified", "Verify the organisation first.");
    await tx.update(brands).set({ brandOrgId: null }).where(eq(brands.brandOrgId, o.id));
    if (input.brandId) await tx.update(brands).set({ brandOrgId: o.id }).where(eq(brands.id, input.brandId));
    await log(tx, { orgId: o.id, target: "org", targetId: o.id, action: "link_access_brand", actorId: input.staffId });
  });
}

// ── Directory claims and logos (four eyes) ──────────────────────────────────

async function lockClaim(tx: DbExecutor, claimId: string) {
  const [c] = await tx.select().from(brandOrgClaims).where(eq(brandOrgClaims.id, claimId)).for("update");
  if (!c) throw new BrandOrgError("not_found");
  return c;
}

export async function decideClaim(
  db: Database,
  input: { staffId: string; claimId: string; step: "verify" | "approve" | "reject"; reason?: string | null },
) {
  await db.transaction(async (tx) => {
    const c = await lockClaim(tx, input.claimId);
    if (input.step === "verify") {
      if (c.status !== "pending") throw new BrandOrgError("wrong_state");
      await tx
        .update(brandOrgClaims)
        .set({ status: "verified", verifiedBy: input.staffId })
        .where(eq(brandOrgClaims.id, c.id));
    } else if (input.step === "approve") {
      if (c.status !== "verified") throw new BrandOrgError("wrong_state", "Verify the claim first.");
      if (c.verifiedBy === input.staffId)
        throw new BrandOrgError("four_eyes", "A different admin has to approve the claim you checked.");
      const [other] = await tx
        .select({ id: brandOrgClaims.id })
        .from(brandOrgClaims)
        .where(and(eq(brandOrgClaims.directoryId, c.directoryId), eq(brandOrgClaims.status, "approved")));
      if (other) throw new BrandOrgError("wrong_state", "Another organisation already holds this brand.");
      await tx
        .update(brandOrgClaims)
        .set({ status: "approved", approvedBy: input.staffId })
        .where(eq(brandOrgClaims.id, c.id));
    } else {
      if (!reasonOk(input.reason)) throw new BrandOrgError("invalid", "Choose a reason.");
      if (c.status === "approved" || c.status === "rejected") throw new BrandOrgError("wrong_state");
      await tx.update(brandOrgClaims).set({ status: "rejected" }).where(eq(brandOrgClaims.id, c.id));
    }
    await log(tx, {
      orgId: c.orgId,
      target: "claim",
      targetId: c.id,
      action: input.step,
      reason: input.reason,
      actorId: input.staffId,
    });
  });
}

export async function decideLogo(
  db: Database,
  input: { staffId: string; claimId: string; step: "verify" | "approve" | "reject"; reason?: string | null },
) {
  await db.transaction(async (tx) => {
    const c = await lockClaim(tx, input.claimId);
    if (!c.logoKey || !c.logoStatus) throw new BrandOrgError("wrong_state", "No logo uploaded.");
    if (input.step === "verify") {
      if (c.logoStatus !== "pending") throw new BrandOrgError("wrong_state");
      if (c.logoScan !== "clean") throw new BrandOrgError("wrong_state", "The logo hasn't passed scanning.");
      await tx
        .update(brandOrgClaims)
        .set({ logoStatus: "verified", logoVerifiedBy: input.staffId })
        .where(eq(brandOrgClaims.id, c.id));
    } else if (input.step === "approve") {
      if (c.logoStatus !== "verified") throw new BrandOrgError("wrong_state", "Check the logo first.");
      if (c.status !== "approved") throw new BrandOrgError("wrong_state", "Approve the brand claim first.");
      if (c.logoVerifiedBy === input.staffId)
        throw new BrandOrgError("four_eyes", "A different admin has to approve the logo you checked.");
      await tx
        .update(brandOrgClaims)
        .set({ logoStatus: "approved", logoApprovedBy: input.staffId })
        .where(eq(brandOrgClaims.id, c.id));
    } else {
      if (!reasonOk(input.reason)) throw new BrandOrgError("invalid", "Choose a reason.");
      await tx.update(brandOrgClaims).set({ logoStatus: "rejected" }).where(eq(brandOrgClaims.id, c.id));
    }
    await log(tx, {
      orgId: c.orgId,
      target: "logo",
      targetId: c.id,
      action: input.step,
      reason: input.reason,
      actorId: input.staffId,
    });
  });
}

/** Directory entries an organisation has claimed (read-only, for /brand-work/directory). */
export async function claimedDirectoryEntries(db: DbExecutor, directoryIds: string[]) {
  if (!directoryIds.length) return new Map<string, { orgName: string; status: string }>();
  const rows = await db
    .select({ directoryId: brandOrgClaims.directoryId, orgName: brandOrgs.legalName, status: brandOrgClaims.status })
    .from(brandOrgClaims)
    .innerJoin(brandOrgs, eq(brandOrgs.id, brandOrgClaims.orgId))
    .where(and(inArray(brandOrgClaims.directoryId, directoryIds), eq(brandOrgClaims.status, "approved")));
  return new Map(rows.map((r) => [r.directoryId, { orgName: r.orgName, status: r.status }]));
}

/** The stored logo behind a claim, for the reviewer viewing it (any status; the view is audited). */
export async function logoForReview(db: DbExecutor, input: { staffId: string; claimId: string }) {
  const [c] = await db
    .select({
      orgId: brandOrgClaims.orgId,
      key: brandOrgClaims.logoKey,
      mime: brandOrgClaims.logoMime,
      provider: brandOrgClaims.logoProvider,
      scan: brandOrgClaims.logoScan,
    })
    .from(brandOrgClaims)
    .where(eq(brandOrgClaims.id, input.claimId));
  if (!c?.key || !c.mime || !c.provider || c.scan !== "clean") return null;
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.staffId,
    eventType: "brand_org.logo_viewed",
    entityType: "brand_org",
    entityId: c.orgId,
    metadata: { claim: input.claimId },
  });
  return { key: c.key, mime: c.mime, provider: c.provider };
}
