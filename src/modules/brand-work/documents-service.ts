import { createHash, randomBytes } from "node:crypto";

import { and, count, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brandWorkDocuments, brandWorkRecords } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { enqueueJob } from "@/modules/jobs";
import type { DocumentStorageProvider } from "@/providers/document-storage/types";
import type { FileScanProvider } from "@/providers/file-scan/types";

import { ALLOWED_MIME_TYPES, MAX_DOCUMENTS_PER_RECORD, MAX_DOCUMENT_BYTES, type DocumentKind } from "./domain";
import { BrandWorkError } from "./errors";
import { sniffMimeType } from "./rules";

/**
 * Document uploads (Stage 18). Bytes go through our server (the strict CSP is
 * unchanged), are checked by magic bytes as well as MIME type, stored under an
 * opaque random key (no creator id, no filename) and scanned by a job. The
 * original filename is never kept. Nothing about the contents is logged.
 */

const sqlErasureOn = sql`set local creatorco.erasure = 'on'`;

export interface StorageDeps {
  db: Database;
  storage: DocumentStorageProvider;
  /** The vendor-neutral config key serving storage (recorded with each document). */
  storageKey: string;
  now?: Date;
}

export async function uploadDocument(
  deps: StorageDeps,
  input: { userId: string; recordId: string; kind: DocumentKind; bytes: Uint8Array; declaredType: string },
): Promise<{ documentId: string; reused: boolean; scanJobId: string | null }> {
  const now = deps.now ?? new Date();
  if (input.bytes.byteLength === 0) throw new BrandWorkError("file_rejected", "That file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES)
    throw new BrandWorkError("file_rejected", "Files can be up to 10 MB.");
  const sniffed = sniffMimeType(input.bytes);
  if (
    !sniffed ||
    !(ALLOWED_MIME_TYPES as readonly string[]).includes(input.declaredType) ||
    sniffed !== input.declaredType
  )
    throw new BrandWorkError("file_rejected", "Upload a PDF, JPEG or PNG.");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  // Validate and reserve the row first; the bytes are stored after the checks pass.
  const reserved = await deps.db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(brandWorkRecords)
      .where(and(eq(brandWorkRecords.id, input.recordId), eq(brandWorkRecords.userId, input.userId)))
      .for("update");
    if (!r) throw new BrandWorkError("not_found");
    const remittance = input.kind === "remittance_advice";
    const allowed = remittance ? ["draft", "needs_info", "verified"] : ["draft", "needs_info"];
    if (!allowed.includes(r.verificationStatus))
      throw new BrandWorkError("wrong_state", "You can't add documents while the record is being reviewed.");
    if (!(await hasValidConsent(tx, input.userId, CONSENT_KEYS.brandWorkRecords, now)))
      throw new BrandWorkError("consent_required");
    const [n] = await tx.select({ n: count() }).from(brandWorkDocuments).where(eq(brandWorkDocuments.recordId, r.id));
    if (Number(n?.n ?? 0) >= MAX_DOCUMENTS_PER_RECORD)
      throw new BrandWorkError("too_many_documents", `A record can have up to ${MAX_DOCUMENTS_PER_RECORD} documents.`);
    // Same file already on this record: nothing to store.
    const [same] = await tx
      .select({ id: brandWorkDocuments.id })
      .from(brandWorkDocuments)
      .where(and(eq(brandWorkDocuments.recordId, r.id), eq(brandWorkDocuments.sha256, sha256)));
    if (same) return { documentId: same.id, reused: true as const, creatorId: r.creatorId, storageKey: null };
    // Same file on another of this creator's records: reuse its stored object — only once it has
    // scanned clean. A pending or rejected copy gets its own object and scan, so nothing waits forever.
    const [mine] = await tx
      .select({
        key: brandWorkDocuments.storageKey,
        provider: brandWorkDocuments.storageProvider,
        scan: brandWorkDocuments.scanStatus,
      })
      .from(brandWorkDocuments)
      .where(
        and(
          eq(brandWorkDocuments.creatorId, r.creatorId),
          eq(brandWorkDocuments.sha256, sha256),
          eq(brandWorkDocuments.scanStatus, "clean"),
        ),
      )
      .limit(1);
    const storageKey = mine?.key ?? `bw/${randomBytes(16).toString("hex")}`;
    const [doc] = await tx
      .insert(brandWorkDocuments)
      .values({
        recordId: r.id,
        creatorId: r.creatorId,
        kind: input.kind,
        storageKey,
        storageProvider: mine?.provider ?? deps.storageKey,
        sha256,
        mimeType: sniffed,
        sizeBytes: input.bytes.byteLength,
        scanStatus: mine ? "clean" : "pending",
        uploadedAt: now,
      })
      .returning({ id: brandWorkDocuments.id });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_work.document_uploaded",
      entityType: "brand_work_record",
      entityId: r.id,
      metadata: { kind: input.kind, size_kb: Math.ceil(input.bytes.byteLength / 1024), reused_object: Boolean(mine) },
    });
    return {
      documentId: doc!.id,
      reused: false as const,
      creatorId: r.creatorId,
      storageKey: mine ? null : storageKey,
    };
  });
  if (reserved.reused) return { documentId: reserved.documentId, reused: true, scanJobId: null };
  if (reserved.storageKey) {
    try {
      await deps.storage.put({ key: reserved.storageKey, bytes: input.bytes, contentType: sniffed });
    } catch (error) {
      // Undo the reservation so the creator can retry; the bytes never landed.
      await deps.db.transaction(async (tx) => {
        await tx.execute(sqlErasureOn);
        await tx.delete(brandWorkDocuments).where(eq(brandWorkDocuments.id, reserved.documentId));
      });
      throw error;
    }
    const scanJobId = await enqueueJob(deps.db, {
      type: "brand_work_scan_document",
      payload: { documentId: reserved.documentId },
    });
    return { documentId: reserved.documentId, reused: false, scanJobId };
  }
  return { documentId: reserved.documentId, reused: false, scanJobId: null };
}

/**
 * Job `brand_work_scan_document`: scans a pending document. Clean → maybe moves
 * its record to review. Rejected → the object is deleted and the record asks
 * the creator for another copy. Idempotent.
 */
export async function scanDocument(
  deps: { db: Database; storage: DocumentStorageProvider; scanner: FileScanProvider; now?: Date },
  documentId: string,
): Promise<{ scanned: number; rejected: number }> {
  const now = deps.now ?? new Date();
  const [doc] = await deps.db.select().from(brandWorkDocuments).where(eq(brandWorkDocuments.id, documentId));
  if (!doc || doc.scanStatus !== "pending") return { scanned: 0, rejected: 0 };
  const object = await deps.storage.get({ key: doc.storageKey });
  const { verdict } = await deps.scanner.scan({ bytes: object.bytes, contentType: doc.mimeType });
  await deps.db.transaction(async (tx) => {
    await tx.update(brandWorkDocuments).set({ scanStatus: verdict }).where(eq(brandWorkDocuments.id, doc.id));
    await recordAuditEvent(tx, {
      actorType: "system",
      eventType: verdict === "clean" ? "brand_work.document_clean" : "brand_work.document_rejected",
      entityType: "brand_work_record",
      entityId: doc.recordId,
    });
    await advanceIfScanned(tx, doc.recordId, now);
  });
  if (verdict === "rejected") {
    await enqueueJob(deps.db, {
      type: "brand_work_erase_documents",
      payload: { key: doc.storageKey, provider: doc.storageProvider },
    });
  }
  return { scanned: 1, rejected: verdict === "rejected" ? 1 : 0 };
}

/** A submitted record whose documents are all scanned moves to review (or back to the creator if none are usable). */
export async function advanceIfScanned(tx: DbExecutor, recordId: string, _now: Date) {
  const [r] = await tx.select().from(brandWorkRecords).where(eq(brandWorkRecords.id, recordId)).for("update");
  if (!r || r.verificationStatus !== "submitted") return;
  const docs = await tx
    .select({ kind: brandWorkDocuments.kind, scan: brandWorkDocuments.scanStatus })
    .from(brandWorkDocuments)
    .where(eq(brandWorkDocuments.recordId, r.id));
  if (docs.some((d) => d.scan === "pending")) return;
  const usable = docs.some((d) => d.kind !== "remittance_advice" && d.scan === "clean");
  await tx
    .update(brandWorkRecords)
    .set(
      usable
        ? { verificationStatus: "in_review" }
        : { verificationStatus: "needs_info", reasonCode: "documents_unreadable" },
    )
    .where(eq(brandWorkRecords.id, r.id));
}

/**
 * Job `brand_work_erase_documents`: deletes one stored object once no usable
 * document row still points at it (the same file can back two of a creator's
 * records). Idempotent; a missing object counts as erased.
 */
export async function eraseStoredDocument(deps: { db: DbExecutor; storage: DocumentStorageProvider }, key: string) {
  const [still] = await deps.db
    .select({ n: count() })
    .from(brandWorkDocuments)
    .where(and(eq(brandWorkDocuments.storageKey, key), sql`${brandWorkDocuments.scanStatus} <> 'rejected'`));
  if (Number(still?.n ?? 0) > 0) return { erased: 0, kept: 1 };
  try {
    await deps.storage.delete({ key });
  } catch {
    // A missing object is already erased.
  }
  return { erased: 1, kept: 0 };
}

/** Storage keys for a set of records, for erase jobs. Keys still used by another record of the creator are kept. */
export async function storageKeysToErase(tx: DbExecutor, recordIds: string[]) {
  if (!recordIds.length) return [];
  const docs = await tx
    .select({ key: brandWorkDocuments.storageKey, provider: brandWorkDocuments.storageProvider })
    .from(brandWorkDocuments)
    .where(inArray(brandWorkDocuments.recordId, recordIds));
  return [...new Map(docs.map((d) => [d.key, d])).values()];
}

/** The storage config key that holds a document (for routing the scan to the same provider). */
export async function getDocumentStorageKey(db: DbExecutor, documentId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
  const [d] = await db
    .select({ provider: brandWorkDocuments.storageProvider })
    .from(brandWorkDocuments)
    .where(eq(brandWorkDocuments.id, documentId));
  return d?.provider ?? null;
}

/**
 * For the mock viewer route: a clean document under this key that the viewer
 * may see (not on their own record), with its storage config and type.
 */
export async function documentForViewer(db: DbExecutor, key: string, viewerId: string) {
  const [doc] = await db
    .select({ provider: brandWorkDocuments.storageProvider, mime: brandWorkDocuments.mimeType })
    .from(brandWorkDocuments)
    .innerJoin(brandWorkRecords, eq(brandWorkRecords.id, brandWorkDocuments.recordId))
    .where(
      and(
        eq(brandWorkDocuments.storageKey, key),
        eq(brandWorkDocuments.scanStatus, "clean"),
        sql`${brandWorkRecords.userId} <> ${viewerId}`,
      ),
    )
    .limit(1);
  return doc ?? null;
}
