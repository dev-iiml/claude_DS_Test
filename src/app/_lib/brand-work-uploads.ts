import "server-only";

import { getDb } from "@/db";
import { BrandWorkError, uploadDocument } from "@/modules/brand-work";
import { MAX_DOCUMENT_BYTES } from "@/modules/brand-work/domain";
import { documentKindSchema } from "@/modules/brand-work/schemas";
import { resolveProvider } from "@/modules/integrations/router";
import { getServerEnv } from "@/lib/env";
import { runDueJobs } from "@/modules/jobs";
import { JOB_HANDLERS } from "@/modules/jobs/handlers";

/** Multipart overhead allowance on top of the 10 MB file limit. */
const MAX_FORM_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024;

/** Reads a multipart body without ever buffering more than the cap. */
async function readCappedForm(request: Request): Promise<FormData> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_FORM_BYTES) throw new BrandWorkError("file_rejected", "Files can be up to 10 MB.");
  if (!request.body) throw new BrandWorkError("file_rejected", "Choose a file to upload.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FORM_BYTES) {
      await reader.cancel();
      throw new BrandWorkError("file_rejected", "Files can be up to 10 MB.");
    }
    chunks.push(value);
  }
  return new Request("http://upload.local/", {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: Buffer.concat(chunks),
  }).formData();
}

/**
 * One document upload (web form or API v1). The original filename is never
 * read or kept; the bytes go to document storage under an opaque key.
 */
export async function handleBrandWorkUpload(request: Request, input: { userId: string; recordId: string }) {
  const form = await readCappedForm(request);
  const kind = documentKindSchema.safeParse(form.get("kind"));
  if (!kind.success) throw new BrandWorkError("invalid", "Choose what kind of document this is.");
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) throw new BrandWorkError("file_rejected", "Choose a file to upload.");
  const db = getDb();
  const routing = { db, production: getServerEnv().APP_ENV === "production" };
  const resolved = await resolveProvider(routing, "document_storage");
  // The document-storage kill switch (or an outage) pauses uploads before anything is stored.
  if (resolved.selection.status !== "ok")
    throw new BrandWorkError("uploads_paused", "Uploads are paused for the moment. Please try again later.");
  const result = await uploadDocument(
    { db, storage: resolved.provider, storageKey: resolved.provider.descriptor.key },
    {
      userId: input.userId,
      recordId: input.recordId,
      kind: kind.data,
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredType: file.type,
    },
  );
  // Scan straight away in this process (the job also retries on its own schedule if this attempt fails).
  if (result.scanJobId) {
    try {
      await runDueJobs({ db, handlers: JOB_HANDLERS }, { onlyIds: [result.scanJobId] });
    } catch {
      // Left queued for the next tick.
    }
  }
  return result;
}
