import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic routing only: if no session cookie is present on a protected
 * path, redirect to sign-in early. The authoritative checks happen in the
 * Data Access Layer (`src/modules/identity/dal.ts`) on every page and action.
 */
const SESSION_COOKIES = ["__Host-cc_session", "cc_session"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
    "/ops/:path*",
    "/partnerships/:path*",
    "/insights/:path*",
    "/passport/:path*",
    "/account/:path*",
    "/access/:path*",
    "/connect/:path*",
    "/paused",
    "/eligibility/:path*",
  ],
};
