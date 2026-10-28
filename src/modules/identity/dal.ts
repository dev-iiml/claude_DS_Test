import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { isOnboardingComplete } from "@/modules/creator-profile/queries";

import { resolveSession, type AuthDeps, type SessionUser } from "./auth/auth-service";
import { canAccessAdmin, canAccessCreatorArea, canAccessOps, canAccessPartnerships, homePathFor } from "./policy";
import { readSessionToken } from "./session-cookie";

/**
 * Data Access Layer for authentication/authorisation. Every protected page,
 * server action and route handler calls one of the `require*` functions —
 * proxy checks are only an optimisation and layouts are not relied upon.
 */
export function authDeps(): AuthDeps {
  return { db: getDb(), sessionTtlHours: getServerEnv().SESSION_TTL_HOURS };
}

/** The current user, memoised per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  return resolveSession(authDeps(), token);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Creator-only areas. Staff are sent to their own home. */
export async function requireCreator(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccessCreatorArea(user.role)) redirect(homePathFor({ role: user.role, onboardingComplete: false }));
  return user;
}

/** Admin areas respond 404 to everyone else, so their existence isn't advertised. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccessAdmin(user.role)) notFound();
  return user;
}

/** The integration control plane: ops admins and super admins; 404 for everyone else. */
export async function requireOpsAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccessOps(user.role)) notFound();
  return user;
}

/** The brand partnerships desk: partnerships admins and super admins; 404 for everyone else. */
export async function requirePartnershipsAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccessPartnerships(user.role)) notFound();
  return user;
}

export async function homePathForUser(user: SessionUser): Promise<string> {
  const onboardingComplete = user.role === "creator" ? await isOnboardingComplete(getDb(), user.userId) : false;
  return homePathFor({ role: user.role, onboardingComplete });
}
