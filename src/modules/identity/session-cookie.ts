import "server-only";

import { cookies } from "next/headers";

import { isSecureCookieEnv } from "@/lib/env";

/**
 * Session cookie handling. In secure environments the `__Host-` prefix pins
 * the cookie to this host, HTTPS and path `/`.
 */
export function sessionCookieName(): string {
  return isSecureCookieEnv() ? "__Host-cc_session" : "cc_session";
}

/** Both names, so the proxy can check presence without knowing the environment. */
export const SESSION_COOKIE_NAMES = ["__Host-cc_session", "cc_session"] as const;

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(sessionCookieName())?.value ?? null;
}

export async function writeSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureCookieEnv(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(sessionCookieName());
}
