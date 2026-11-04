import "server-only";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { resolveProvider } from "@/modules/integrations/router";

/**
 * Small image uploads (Stage 19: passport photo, brand logo). The body is read
 * with a hard cap, never buffered past it; the original filename is ignored.
 */
export class ImageUploadError extends Error {
  constructor(readonly code: "too_large" | "missing" | "paused") {
    super(code);
    this.name = "ImageUploadError";
  }
}

export async function readCappedImage(
  request: Request,
  maxBytes: number,
): Promise<{ form: FormData; bytes: Uint8Array; type: string }> {
  const cap = maxBytes + 32 * 1024;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > cap) throw new ImageUploadError("too_large");
  if (!request.body) throw new ImageUploadError("missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      throw new ImageUploadError("too_large");
    }
    chunks.push(value);
  }
  const form = await new Request("http://upload.local/", {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: Buffer.concat(chunks),
  }).formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) throw new ImageUploadError("missing");
  return { form, bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
}

/** The routed storage and scanner; a paused or failing storage pauses uploads before anything is stored. */
export async function uploadProviders() {
  const db = getDb();
  const routing = { db, production: getServerEnv().APP_ENV === "production" };
  const storage = await resolveProvider(routing, "document_storage");
  if (storage.selection.status !== "ok") throw new ImageUploadError("paused");
  const scanner = await resolveProvider(routing, "file_scan");
  return { db, storage: storage.provider, scanner: scanner.provider, storageKey: storage.provider.descriptor.key };
}

/** `Origin: null` or anything unparsable counts as cross-site. */
export function sameOrigin(origin: string | null, host: string) {
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
