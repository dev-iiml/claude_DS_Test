import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { publicPassports } from "@/db/schema";
import { recordAuditEvent } from "@/modules/audit";
import { sniffMimeType } from "@/modules/brand-work/rules";
import { enqueueJob } from "@/modules/jobs";
import type { DocumentStorageProvider } from "@/providers/document-storage/types";
import type { FileScanProvider } from "@/providers/file-scan/types";

import { PHOTO_MAX_BYTES, PHOTO_MIME_TYPES } from "./domain";
import { PassportError } from "./errors";
import { ensurePassport } from "./settings-service";

/**
 * The creator-uploaded passport photo (Stage 19): PNG or JPEG by magic bytes,
 * up to 3 MB, scanned before it's stored under an opaque `pp/<hex>` key. A
 * replaced or withdrawn photo's object is deleted by a job.
 */
export async function uploadPassportPhoto(
  deps: { db: Database; storage: DocumentStorageProvider; scanner: FileScanProvider; storageKey: string },
  input: { userId: string; bytes: Uint8Array; declaredType: string },
) {
  if (!input.bytes.byteLength || input.bytes.byteLength > PHOTO_MAX_BYTES)
    throw new PassportError("file_rejected", "Photos can be up to 3 MB.");
  const sniffed = sniffMimeType(input.bytes);
  if (!sniffed || sniffed !== input.declaredType || !(PHOTO_MIME_TYPES as readonly string[]).includes(sniffed))
    throw new PassportError("file_rejected", "Upload a JPEG or PNG.");
  const { verdict } = await deps.scanner.scan({ bytes: input.bytes, contentType: sniffed });
  if (verdict !== "clean") throw new PassportError("file_rejected", "That file didn't pass our checks.");
  const passport = await ensurePassport(deps.db, input.userId);
  const key = `pp/${randomBytes(16).toString("hex")}`;
  await deps.storage.put({ key, bytes: input.bytes, contentType: sniffed });
  await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(publicPassports).where(eq(publicPassports.id, passport.id)).for("update");
    await tx
      .update(publicPassports)
      .set({
        photoKey: key,
        photoMime: sniffed,
        photoProvider: deps.storageKey,
        photoScan: "clean",
        cacheVersion: row!.cacheVersion + 1,
      })
      .where(eq(publicPassports.id, passport.id));
    if (row?.photoKey)
      await enqueueJob(tx, {
        type: "public_passport_purge",
        payload: { key: row.photoKey, provider: row.photoProvider ?? deps.storageKey },
      });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "public_passport.photo_uploaded",
      entityType: "public_passport",
      entityId: passport.id,
      metadata: { size_kb: Math.ceil(input.bytes.byteLength / 1024) },
    });
  });
}

export async function removePassportPhoto(db: Database, userId: string) {
  const passport = await ensurePassport(db, userId);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(publicPassports).where(eq(publicPassports.id, passport.id)).for("update");
    if (!row?.photoKey) return;
    await tx
      .update(publicPassports)
      .set({
        photoKey: null,
        photoMime: null,
        photoProvider: null,
        photoScan: null,
        cacheVersion: row.cacheVersion + 1,
      })
      .where(eq(publicPassports.id, row.id));
    await enqueueJob(tx, {
      type: "public_passport_purge",
      payload: { key: row.photoKey, provider: row.photoProvider ?? "mock" },
    });
  });
}
