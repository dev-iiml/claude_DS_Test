import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { ProviderError } from "../errors";
import type { ProviderHealth } from "../types";
import type { DocumentStorageProvider } from "./types";
import { isSampleKey, samplePdf } from "./sample-documents";

/**
 * In-process mock: keeps bytes in memory for the life of the server process
 * (fine for development and tests; staging uses fictional documents only).
 * Signed URLs point at a staff-guarded route that re-checks the role.
 */
const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

/** Per-process signing key: links are only valid on the process that issued them (like the bytes). */
const SIGNING_KEY = randomBytes(32);
const sign = (key: string, exp: number, viewerId: string) =>
  createHmac("sha256", SIGNING_KEY).update(`${key}|${exp}|${viewerId}`).digest("base64url");

/** Checks a mock link: signed by this process, unexpired and issued to this viewer. */
export function verifyMockSignedUrl(input: { key: string; exp: number; viewerId: string; sig: string; now?: number }) {
  if (!Number.isFinite(input.exp) || input.exp < (input.now ?? Date.now())) return false;
  const expected = Buffer.from(sign(input.key, input.exp, input.viewerId));
  const given = Buffer.from(input.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class MockDocumentStorageProvider implements DocumentStorageProvider {
  readonly descriptor = { key: "mock", kind: "document_storage", mode: "mock" } as const;

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  async put(input: { key: string; bytes: Uint8Array; contentType: string }) {
    objects.set(input.key, { bytes: input.bytes, contentType: input.contentType });
  }

  async getSignedReadUrl(input: { key: string; ttlSeconds: number; viewerId: string }) {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const exp = expiresAt.getTime();
    const sig = sign(input.key, exp, input.viewerId);
    return {
      url: `/brand-work/documents/view?key=${encodeURIComponent(input.key)}&exp=${exp}&sig=${sig}`,
      expiresAt,
    };
  }

  async delete(input: { key: string }) {
    objects.delete(input.key);
  }

  async get(input: { key: string }) {
    const o = objects.get(input.key);
    if (o) return o;
    // Fictional seed documents (staging/dev demo) are regenerated on read, so no real file is ever needed.
    if (isSampleKey(input.key)) return { bytes: samplePdf(input.key), contentType: "application/pdf" };
    throw new ProviderError("rejected", "not found");
  }
}
