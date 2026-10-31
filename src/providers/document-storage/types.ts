import type { Provider } from "../types";

/**
 * Private document storage (bought, not built). Objects are written under an
 * opaque key chosen by CreatorCo (no creator id, no filename) and encrypted
 * at rest by the provider. Signed read URLs are short-lived and issued only
 * to staff (every issue is audited by the caller).
 */
export interface DocumentStorageProvider extends Provider {
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  /** `viewerId` binds the link to the staff member it was issued to (where the vendor supports it). */
  getSignedReadUrl(input: {
    key: string;
    ttlSeconds: number;
    viewerId: string;
  }): Promise<{ url: string; expiresAt: Date }>;
  /** Server-side read for scanning (and the mock's staff viewer). Never sent to analytics or logs. */
  get(input: { key: string }): Promise<{ bytes: Uint8Array; contentType: string }>;
  delete(input: { key: string }): Promise<void>;
}
