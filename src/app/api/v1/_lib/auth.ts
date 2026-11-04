import "server-only";

import type { NextRequest } from "next/server";

import { getDb } from "@/db";
import { getMembership } from "@/modules/brand-orgs/org-service";
import { authDeps } from "@/modules/identity";
import { resolveSession, type SessionUser } from "@/modules/identity/auth/auth-service";
import type { SessionClient } from "@/modules/identity/domain";
import { canAccessBrandApp, canAccessCreatorArea } from "@/modules/identity/policy";

import { ApiError } from "./http";

/** Session types accepted as bearer tokens. Browser (`web`) sessions only work as cookies. */
export const API_CLIENTS = ["ios", "android", "api"] as const satisfies readonly SessionClient[];

export function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(header);
  return match?.[1] ?? null;
}

/** Bearer-only authentication. Cookies are ignored on `/api/v1`, so there is no CSRF surface. */
export async function requireApiUser(request: NextRequest): Promise<SessionUser & { token: string }> {
  const token = bearerToken(request);
  const user = token ? await resolveSession(authDeps(), token, API_CLIENTS) : null;
  if (!user || !token) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  return { ...user, token };
}

export async function requireApiCreator(request: NextRequest) {
  const user = await requireApiUser(request);
  if (!canAccessCreatorArea(user.role)) throw new ApiError(403, "forbidden", "This endpoint is for creator accounts.");
  return user;
}

/** Brand app over the API (Stage 19): a brand member with an active membership. */
export async function requireApiBrandMember(request: NextRequest) {
  const user = await requireApiUser(request);
  if (!canAccessBrandApp(user.role))
    throw new ApiError(403, "forbidden", "This endpoint is for brand organisation accounts.");
  const membership = await getMembership(getDb(), user.userId);
  if (!membership) throw new ApiError(403, "forbidden", "This account isn't part of an organisation.");
  return { ...user, membership };
}
