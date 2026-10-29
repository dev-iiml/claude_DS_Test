/**
 * Content Security Policy (Stage 16) — strict, nonce-based. A fresh nonce per
 * request (set by `src/proxy.ts`); Next.js applies it to its own scripts and
 * styles. No third-party origins: CreatorCo loads no external scripts, fonts or
 * trackers. Inline `style="…"` attributes are allowed (`style-src-attr`) since
 * the design system positions a few elements that way; inline scripts are not.
 *
 * A live provider whose sign-in is a redirect after a form post (e.g. social
 * OAuth) will need its origin in `form-action` — add it here, reviewed.
 */
export interface CspOptions {
  nonce: string;
  /** `next dev`: React needs eval for debugging, and HMR uses a websocket. */
  dev: boolean;
  /** Served over HTTPS (staging/production): upgrade any http subresource. */
  secure: boolean;
}

export function contentSecurityPolicy({ nonce, dev, secure }: CspOptions): string {
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (secure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** For JSON APIs: nothing may load or frame. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** 128-bit random nonce, base64. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
