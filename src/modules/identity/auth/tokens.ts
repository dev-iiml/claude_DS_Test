import { createHash, randomBytes } from "node:crypto";

/** 256-bit opaque session token, base64url. Only its SHA-256 is stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Hash used for login throttling so attempt rows never hold a plaintext email. */
export function emailThrottleKey(email: string): string {
  return sha256Hex(`login:${normaliseEmail(email)}`);
}
