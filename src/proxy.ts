import { NextResponse, type NextRequest } from "next/server";

import { appEnvOf } from "@/lib/app-env";
import { contentSecurityPolicy, generateNonce } from "@/lib/csp";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
  attributionFrom,
  encodeAttribution,
  parseCampaigns,
} from "@/modules/analytics/attribution";

/**
 * Runs before every page request:
 *
 * 1. Content Security Policy (Stage 16): a fresh nonce per request, passed to
 *    Next.js in the request's CSP header so it nonces its own scripts.
 * 2. Optimistic routing only: if no session cookie is present on a protected
 *    path, redirect to sign-in early. The authoritative checks happen in the
 *    Data Access Layer (`src/modules/identity/dal.ts`) on every page and action.
 *
 * 3. Sign-up attribution (Stage 16): on a signed-out visit carrying campaign
 *    tags or an outside referrer, a short-lived first-party cookie keeps the
 *    slugs until sign-up (no identifier; see modules/analytics/attribution.ts).
 *
 * API routes, static files and prefetches are excluded (APIs get a deny-all
 * CSP from next.config.ts).
 */
const SESSION_COOKIES = ["__Host-cc_session", "cc_session"];

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/admin",
  "/ops",
  "/partnerships",
  "/insights",
  "/passport",
  "/account",
  "/access",
  "/connect",
  "/paused",
  "/eligibility",
];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function rememberAttribution(request: NextRequest, response: NextResponse, appEnv: string) {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return;
  const found = attributionFrom(
    request.nextUrl.searchParams,
    request.headers.get("referer"),
    request.nextUrl.hostname,
    parseCampaigns(process.env.ANALYTICS_CAMPAIGNS),
  );
  if (!found) return;
  // Campaign tags replace earlier ones (last touch); a bare referrer never overwrites a remembered visit.
  const tagged = found.utm_source || found.utm_medium || found.utm_campaign;
  if (!tagged && request.cookies.has(ATTRIBUTION_COOKIE)) return;
  response.cookies.set(ATTRIBUTION_COOKIE, encodeAttribution(found), {
    httpOnly: true,
    sameSite: "lax",
    secure: appEnv !== "development" && appEnv !== "test",
    path: "/",
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isProtectedPath(pathname) && !SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const appEnv = appEnvOf();
  const csp = contentSecurityPolicy({
    nonce: generateNonce(),
    dev: process.env.NODE_ENV === "development",
    secure: appEnv !== "development" && appEnv !== "test",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  rememberAttribution(request, response, appEnv);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static/|_next/image|favicon\\.ico$|icon$|apple-icon$|manifest\\.webmanifest$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
