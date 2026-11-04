import { randomBytes } from "node:crypto";

import { and, desc, eq, ilike } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brandDirectory, brandOrgClaims } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { enqueueJob } from "@/modules/jobs";
import { sniffMimeType } from "@/modules/brand-work/rules";
import type { DocumentStorageProvider } from "@/providers/document-storage/types";
import type { FileScanProvider } from "@/providers/file-scan/types";

import { LOGO_MAX_BYTES, LOGO_MIME_TYPES } from "./domain";
import { BrandOrgError } from "./errors";
import { getMembership } from "./org-service";

/**
 * Brand directory claims and logos (Stage 19). A verified organisation claims
 * the directory brand(s) it owns and may upload a logo, ticking "We own or are
 * authorised to use this logo". Logos are type-checked by magic bytes,
 * scanned, stored under an opaque key and shown only after two admins approve.
 */

async function verifiedOwner(db: DbExecutor, userId: string) {
  const m = await getMembership(db, userId);
  if (!m) throw new BrandOrgError("forbidden");
  if (m.orgStatus !== "verified")
    throw new BrandOrgError("not_verified", "Your organisation needs to be verified first.");
  if (m.orgRole !== "owner") throw new BrandOrgError("forbidden", "Only an owner can claim brands.");
  return m;
}

export async function searchDirectoryForClaim(db: DbExecutor, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  return db
    .select({ id: brandDirectory.id, name: brandDirectory.canonicalName })
    .from(brandDirectory)
    .where(
      and(eq(brandDirectory.status, "active"), ilike(brandDirectory.canonicalName, `%${term.replace(/[%_\\]/g, "")}%`)),
    )
    .limit(20);
}

export async function listOrgClaims(db: DbExecutor, orgId: string) {
  return db
    .select({
      id: brandOrgClaims.id,
      brandName: brandDirectory.canonicalName,
      status: brandOrgClaims.status,
      logoStatus: brandOrgClaims.logoStatus,
      logoScan: brandOrgClaims.logoScan,
    })
    .from(brandOrgClaims)
    .innerJoin(brandDirectory, eq(brandDirectory.id, brandOrgClaims.directoryId))
    .where(eq(brandOrgClaims.orgId, orgId))
    .orderBy(desc(brandOrgClaims.createdAt));
}

export async function requestClaim(db: Database, input: { userId: string; directoryId: string }) {
  const m = await verifiedOwner(db, input.userId);
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ id: brandDirectory.id, status: brandDirectory.status })
      .from(brandDirectory)
      .where(eq(brandDirectory.id, input.directoryId));
    if (!entry || entry.status !== "active") throw new BrandOrgError("not_found");
    const [mine] = await tx
      .select({ id: brandOrgClaims.id })
      .from(brandOrgClaims)
      .where(and(eq(brandOrgClaims.orgId, m.orgId), eq(brandOrgClaims.directoryId, entry.id)));
    if (mine) throw new BrandOrgError("wrong_state", "You've already claimed this brand.");
    const [row] = await tx
      .insert(brandOrgClaims)
      .values({ orgId: m.orgId, directoryId: entry.id, createdBy: input.userId })
      .returning({ id: brandOrgClaims.id });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_org.claim_requested",
      entityType: "brand_org",
      entityId: m.orgId,
      metadata: { claim: row!.id },
    });
  });
}

export async function uploadLogo(
  deps: { db: Database; storage: DocumentStorageProvider; scanner: FileScanProvider; storageKey: string },
  input: { userId: string; claimId: string; bytes: Uint8Array; declaredType: string; licenceAccepted: boolean },
) {
  const m = await verifiedOwner(deps.db, input.userId);
  if (!input.licenceAccepted) throw new BrandOrgError("invalid", "Confirm you own or are authorised to use this logo.");
  if (!input.bytes.byteLength || input.bytes.byteLength > LOGO_MAX_BYTES)
    throw new BrandOrgError("file_rejected", "Logos can be up to 1 MB.");
  const sniffed = sniffMimeType(input.bytes);
  if (!sniffed || sniffed !== input.declaredType || !(LOGO_MIME_TYPES as readonly string[]).includes(sniffed))
    throw new BrandOrgError("file_rejected", "Upload a PNG or JPEG.");
  const [claim] = await deps.db
    .select()
    .from(brandOrgClaims)
    .where(and(eq(brandOrgClaims.id, input.claimId), eq(brandOrgClaims.orgId, m.orgId)));
  if (!claim) throw new BrandOrgError("not_found");
  if (claim.status === "rejected") throw new BrandOrgError("wrong_state");
  const { verdict } = await deps.scanner.scan({ bytes: input.bytes, contentType: sniffed });
  if (verdict !== "clean") throw new BrandOrgError("file_rejected", "That file didn't pass our checks.");
  const key = `lg/${randomBytes(16).toString("hex")}`;
  await deps.storage.put({ key, bytes: input.bytes, contentType: sniffed });
  const old = claim.logoKey ? { key: claim.logoKey, provider: claim.logoProvider } : null;
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(brandOrgClaims)
      .set({
        logoKey: key,
        logoMime: sniffed,
        logoProvider: deps.storageKey,
        logoScan: "clean",
        logoStatus: "pending",
        logoVerifiedBy: null,
        logoApprovedBy: null,
        logoLicenceAcceptedBy: input.userId,
        logoLicenceAcceptedAt: now,
      })
      .where(eq(brandOrgClaims.id, claim.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_org.logo_uploaded",
      entityType: "brand_org",
      entityId: m.orgId,
      metadata: { claim: claim.id, size_kb: Math.ceil(input.bytes.byteLength / 1024) },
    });
  });
  // The replaced logo's object is deleted by a job (its own storage config).
  if (old)
    await enqueueJob(deps.db, {
      type: "public_passport_purge",
      payload: { key: old.key, provider: old.provider ?? deps.storageKey },
    });
}
