import { and, count, eq, gt, inArray, isNull } from "drizzle-orm";

import { isUniqueViolation } from "@/db/errors";
import { authIdentities, authLoginAttempts, authSessions, users } from "@/db/schema";
import type { Database } from "@/db/create-db";
import { recordAuditEvent } from "@/modules/audit";
import { recordEvent } from "@/modules/analytics";
import { EMPTY_ATTRIBUTION, type Attribution } from "@/modules/analytics/attribution";

import type { SessionClient, UserRole, UserStatus } from "../domain";
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from "./password";
import { emailThrottleKey, generateSessionToken, normaliseEmail, sha256Hex } from "./tokens";

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MINUTES = 15;

/** The authenticated principal as the rest of the app sees it. */
export interface SessionUser {
  userId: string;
  authUserId: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export interface AuthDeps {
  db: Database;
  sessionTtlHours: number;
  now?: () => Date;
}

const clock = (deps: AuthDeps) => (deps.now ? deps.now() : new Date());

async function issueSession(deps: AuthDeps, identityId: string, client: SessionClient): Promise<IssuedSession> {
  const token = generateSessionToken();
  const now = clock(deps);
  const expiresAt = new Date(now.getTime() + deps.sessionTtlHours * 3_600_000);
  await deps.db.insert(authSessions).values({
    identityId,
    tokenHash: sha256Hex(token),
    client,
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export type SignUpResult =
  { ok: true; user: SessionUser; session: IssuedSession } | { ok: false; reason: "email_taken" };

/** Creates a credential identity + `creator` user. Staff roles are never self-assigned. */
export async function signUpCreator(
  deps: AuthDeps,
  input: { email: string; password: string; client?: SessionClient; attribution?: Attribution },
): Promise<SignUpResult> {
  const email = normaliseEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await deps.db.transaction(async (tx) => {
      const [identity] = await tx
        .insert(authIdentities)
        .values({ email, passwordHash })
        .returning({ id: authIdentities.id });
      if (!identity) throw new Error("identity insert returned no row");

      const [created] = await tx
        .insert(users)
        .values({ authUserId: identity.id, email, role: "creator", status: "active" })
        .returning();
      if (!created) throw new Error("user insert returned no row");

      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: created.id,
        eventType: "auth.signed_up",
        entityType: "user",
        entityId: created.id,
        metadata: { role: created.role },
      });
      await recordEvent(tx, {
        event: "account_created",
        userId: created.id,
        props: { client: input.client ?? "web", ...(input.attribution ?? EMPTY_ATTRIBUTION) },
      });

      return created;
    });

    const session = await issueSession(deps, user.authUserId, input.client ?? "web");
    return {
      ok: true,
      session,
      user: { userId: user.id, authUserId: user.authUserId, email: user.email, role: user.role, status: user.status },
    };
  } catch (error) {
    if (isUniqueViolation(error, "identities_email_key") || isUniqueViolation(error, "users_email_key")) {
      return { ok: false, reason: "email_taken" };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export type SignInResult =
  | { ok: true; user: SessionUser; session: IssuedSession }
  | { ok: false; reason: "invalid_credentials" | "locked" | "inactive" };

async function recentFailures(deps: AuthDeps, emailHash: string): Promise<number> {
  const since = new Date(clock(deps).getTime() - LOGIN_WINDOW_MINUTES * 60_000);
  const [row] = await deps.db
    .select({ n: count() })
    .from(authLoginAttempts)
    .where(
      and(
        eq(authLoginAttempts.emailHash, emailHash),
        eq(authLoginAttempts.succeeded, false),
        gt(authLoginAttempts.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

async function recordAttempt(deps: AuthDeps, emailHash: string, succeeded: boolean) {
  await deps.db.insert(authLoginAttempts).values({ emailHash, succeeded, createdAt: clock(deps) });
}

export async function signIn(
  deps: AuthDeps,
  input: { email: string; password: string; client?: SessionClient },
): Promise<SignInResult> {
  const email = normaliseEmail(input.email);
  const emailHash = emailThrottleKey(email);

  if ((await recentFailures(deps, emailHash)) >= LOGIN_MAX_FAILURES) {
    return { ok: false, reason: "locked" };
  }

  const [row] = await deps.db
    .select({
      identityId: authIdentities.id,
      passwordHash: authIdentities.passwordHash,
      userId: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(authIdentities)
    .innerJoin(users, eq(users.authUserId, authIdentities.id))
    .where(eq(authIdentities.email, email))
    .limit(1);

  // Always run one verification so response time does not reveal whether the account exists.
  const valid = await verifyPassword(input.password, row?.passwordHash ?? (await getDummyHash()));

  if (!row || !valid) {
    await recordAttempt(deps, emailHash, false);
    if (row) {
      await recordAuditEvent(deps.db, {
        actorType: "user",
        actorId: row.userId,
        eventType: "auth.sign_in_failed",
        entityType: "user",
        entityId: row.userId,
      });
    }
    return { ok: false, reason: "invalid_credentials" };
  }

  if (row.status !== "active") {
    return { ok: false, reason: "inactive" };
  }

  await recordAttempt(deps, emailHash, true);

  if (needsRehash(row.passwordHash)) {
    await deps.db
      .update(authIdentities)
      .set({ passwordHash: await hashPassword(input.password), passwordUpdatedAt: clock(deps) })
      .where(eq(authIdentities.id, row.identityId));
  }

  const session = await issueSession(deps, row.identityId, input.client ?? "web");
  await recordAuditEvent(deps.db, {
    actorType: "user",
    actorId: row.userId,
    eventType: "auth.signed_in",
    entityType: "user",
    entityId: row.userId,
    metadata: { role: row.role, client: input.client ?? "web" },
  });

  return {
    ok: true,
    session,
    user: { userId: row.userId, authUserId: row.identityId, email: row.email, role: row.role, status: row.status },
  };
}

// ---------------------------------------------------------------------------
// Session resolution / sign out
// ---------------------------------------------------------------------------

/**
 * Resolves an opaque session token to an active user, or null. `clients`
 * restricts which session types are accepted on a channel: browser cookies
 * accept only `web` sessions, and the bearer API only native/API sessions,
 * so a token can't be replayed across channels.
 */
export async function resolveSession(
  deps: AuthDeps,
  token: string,
  clients: readonly SessionClient[] = ["web"],
): Promise<SessionUser | null> {
  if (!token || token.length > 128) return null;
  const [row] = await deps.db
    .select({
      userId: users.id,
      authUserId: users.authUserId,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.authUserId, authSessions.identityId))
    .where(
      and(
        eq(authSessions.tokenHash, sha256Hex(token)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, clock(deps)),
        inArray(authSessions.client, [...clients]),
      ),
    )
    .limit(1);

  if (!row || row.status !== "active") return null;
  return row;
}

export async function signOut(deps: AuthDeps, token: string): Promise<void> {
  if (!token) return;
  const revoked = await deps.db
    .update(authSessions)
    .set({ revokedAt: clock(deps) })
    .where(and(eq(authSessions.tokenHash, sha256Hex(token)), isNull(authSessions.revokedAt)))
    .returning({ identityId: authSessions.identityId });

  const identityId = revoked[0]?.identityId;
  if (!identityId) return;
  const [user] = await deps.db.select({ id: users.id }).from(users).where(eq(users.authUserId, identityId)).limit(1);
  if (user) {
    await recordAuditEvent(deps.db, {
      actorType: "user",
      actorId: user.id,
      eventType: "auth.signed_out",
      entityType: "user",
      entityId: user.id,
    });
  }
}
