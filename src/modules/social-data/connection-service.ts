import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { isUniqueViolation } from "@/db/errors";
import {
  creatorProfiles,
  creatorSocialAccounts,
  creatorSocialSnapshots,
  socialConnectionRequests,
  socialPlatforms,
} from "@/db/schema";
import { callProvider, recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, ConsentError, grantConsent, hasValidConsent } from "@/modules/consent";
import { sha256Hex } from "@/modules/identity/auth/tokens";
import { MAX_ACCOUNTS_PER_PLATFORM, SELF_DECLARED_PROVIDER } from "@/modules/social-data/domain";
import { runProfessionalGraph } from "@/modules/professional-graph/graph-service";
import type { SocialDataProvider } from "@/providers/social/types";

/**
 * Social account connection (Stage 06). CreatorCo owns the OAuth-style
 * `state`: it is random, stored only as a hash, single-use and short-lived,
 * and bound to the creator who started the flow.
 */
export const CONNECTION_TTL_MINUTES = 10;
export const HISTORY_MONTHS = 12;

export class SocialConnectionError extends Error {
  constructor(
    readonly code:
      | "profile_incomplete"
      | "unsupported_platform"
      | "consent_required"
      | "invalid_state"
      | "expired"
      | "already_used"
      | "platform_mismatch"
      | "linked_elsewhere"
      | "provider_changed"
      | "account_limit"
      | "not_found",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "SocialConnectionError";
  }
}

export interface ConnectionDeps {
  db: Database;
  social: SocialDataProvider;
  /** The provider for a config key: completes a flow begun by a provider that is no longer primary. */
  socialFor?: (key: string) => Promise<SocialDataProvider | null>;
  now?: () => Date;
}

const clock = (d: ConnectionDeps) => (d.now ? d.now() : new Date());

async function completedProfileId(db: Database, userId: string) {
  const [p] = await db
    .select({ id: creatorProfiles.id, status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);
  if (!p || p.status !== "completed") throw new SocialConnectionError("profile_incomplete");
  return p.id;
}

export async function startConnection(
  deps: ConnectionDeps,
  input: {
    userId: string;
    platform: string;
    redirectUri: string;
    connectionConsentId: string;
    /** Optional, separate opt-in to professional analytics. */
    analyticsConsentId?: string | null;
    /** Add another account on a platform that already has a connected one. */
    additional?: boolean;
  },
): Promise<{ authorizationUrl: string }> {
  const now = clock(deps);
  const creatorId = await completedProfileId(deps.db, input.userId);

  const [platform] = await deps.db
    .select()
    .from(socialPlatforms)
    .where(eq(socialPlatforms.code, input.platform))
    .limit(1);
  if (!platform?.isActive || !(deps.social.supportedPlatforms() as readonly string[]).includes(input.platform)) {
    throw new SocialConnectionError(
      "unsupported_platform",
      `${platform?.label ?? input.platform} can't be connected yet.`,
    );
  }

  // An extra account only makes sense next to a connected one, and is capped per platform.
  const activeOnPlatform = await deps.db
    .select({ status: creatorSocialAccounts.connectionStatus })
    .from(creatorSocialAccounts)
    .where(
      and(
        eq(creatorSocialAccounts.creatorId, creatorId),
        eq(creatorSocialAccounts.platform, input.platform),
        ne(creatorSocialAccounts.connectionStatus, "disconnected"),
      ),
    );
  const additional = Boolean(input.additional) && activeOnPlatform.some((a) => a.status === "connected");
  if (additional && activeOnPlatform.length >= MAX_ACCOUNTS_PER_PLATFORM) {
    throw new SocialConnectionError(
      "account_limit",
      `You can connect up to ${MAX_ACCOUNTS_PER_PLATFORM} accounts on ${platform.label}.`,
    );
  }

  try {
    await grantConsent(deps.db, {
      userId: input.userId,
      key: CONSENT_KEYS.socialAccountConnection,
      consentDefinitionId: input.connectionConsentId,
      source: "settings",
      metadata: { surface: "passport_connect", platform: input.platform },
      now,
    });
    if (input.analyticsConsentId) {
      await grantConsent(deps.db, {
        userId: input.userId,
        key: CONSENT_KEYS.professionalAnalytics,
        consentDefinitionId: input.analyticsConsentId,
        source: "settings",
        metadata: { surface: "passport_connect" },
        now,
      });
    }
  } catch (error) {
    if (error instanceof ConsentError)
      throw new SocialConnectionError("consent_required", "Please review the latest consent text.");
    throw error;
  }

  const state = randomBytes(32).toString("base64url");
  await deps.db.insert(socialConnectionRequests).values({
    creatorId,
    platform: input.platform,
    provider: deps.social.descriptor.key,
    stateHash: sha256Hex(state),
    analyticsOptIn: Boolean(input.analyticsConsentId),
    additional,
    expiresAt: new Date(now.getTime() + CONNECTION_TTL_MINUTES * 60_000),
    createdAt: now,
  });

  return callProvider(
    deps.db,
    { userId: input.userId, provider: deps.social.descriptor, operation: "begin_connection" },
    () => deps.social.beginConnection({ platform: input.platform, state, redirectUri: input.redirectUri }),
    () => ({ outcome: "success" }),
  );
}

/** Looks up a pending request for display (e.g. the mock authorisation screen). */
export async function getPendingConnection(db: Database, input: { userId: string; state: string }) {
  const [row] = await db
    .select({
      platform: socialConnectionRequests.platform,
      expiresAt: socialConnectionRequests.expiresAt,
      completedAt: socialConnectionRequests.completedAt,
      creatorUserId: creatorProfiles.userId,
      creatorId: socialConnectionRequests.creatorId,
      additional: socialConnectionRequests.additional,
    })
    .from(socialConnectionRequests)
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, socialConnectionRequests.creatorId))
    .where(eq(socialConnectionRequests.stateHash, sha256Hex(input.state)))
    .limit(1);
  if (!row || row.creatorUserId !== input.userId) return null;
  const [declared] = await db
    .select({ handle: creatorSocialAccounts.declaredHandle })
    .from(creatorSocialAccounts)
    .where(and(eq(creatorSocialAccounts.creatorId, row.creatorId), eq(creatorSocialAccounts.platform, row.platform)))
    .orderBy(desc(creatorSocialAccounts.createdAt))
    .limit(1);
  return {
    platform: row.platform,
    expired: row.expiresAt <= new Date(),
    used: row.completedAt !== null,
    // An extra account has no declaration to prefill.
    declaredHandle: row.additional ? null : (declared?.handle ?? null),
  };
}

export interface CompletedConnection {
  accountId: string;
  platform: string;
  handle: string;
  snapshotsStored: number;
  graphComputed: boolean;
}

export async function completeConnection(
  deps: ConnectionDeps,
  input: { userId: string; state: string; code: string },
): Promise<CompletedConnection> {
  const now = clock(deps);
  const [req] = await deps.db
    .select({ r: socialConnectionRequests, userId: creatorProfiles.userId })
    .from(socialConnectionRequests)
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, socialConnectionRequests.creatorId))
    .where(eq(socialConnectionRequests.stateHash, sha256Hex(input.state)))
    .limit(1);
  // A state issued to someone else is treated exactly like an unknown state.
  if (!req || req.userId !== input.userId) throw new SocialConnectionError("invalid_state");
  if (req.r.completedAt) throw new SocialConnectionError("already_used");
  if (req.r.expiresAt <= now) throw new SocialConnectionError("expired");
  // The code belongs to the provider that began the flow; if ops has switched since, finish with that one.
  let social = deps.social;
  if (req.r.provider !== social.descriptor.key) {
    const pinned = deps.socialFor ? await deps.socialFor(req.r.provider) : null;
    if (!pinned) throw new SocialConnectionError("provider_changed");
    social = pinned;
  }

  const identity = await callProvider(
    deps.db,
    { userId: input.userId, provider: social.descriptor, operation: "complete_connection" },
    () => social.completeConnection({ platform: req.r.platform, code: input.code }),
    () => ({ outcome: "success" }),
  );
  if (identity.platform !== req.r.platform) throw new SocialConnectionError("platform_mismatch");

  const creatorId = req.r.creatorId;
  const provider = social.descriptor.key;

  let accountId: string;
  try {
    accountId = await deps.db.transaction(async (tx) => {
      // Single-use: claim the request atomically.
      const claimed = await tx
        .update(socialConnectionRequests)
        .set({ completedAt: now })
        .where(and(eq(socialConnectionRequests.id, req.r.id), isNull(socialConnectionRequests.completedAt)))
        .returning({ id: socialConnectionRequests.id });
      if (!claimed.length) throw new SocialConnectionError("already_used");

      const rows = await tx
        .select()
        .from(creatorSocialAccounts)
        .where(
          and(eq(creatorSocialAccounts.creatorId, creatorId), eq(creatorSocialAccounts.platform, identity.platform)),
        )
        .orderBy(desc(creatorSocialAccounts.createdAt));
      const active = rows.filter((r) => r.connectionStatus !== "disconnected");
      // Reconnecting the same account updates it; an extra account is always its own row; otherwise the
      // connection upgrades the creator's self-declared row for this platform.
      const target =
        active.find((r) => r.externalAccountId === identity.externalAccountId) ??
        (req.r.additional ? null : (active.find((r) => r.connectionStatus === "declared") ?? null)) ??
        null;
      if (!target && active.length >= MAX_ACCOUNTS_PER_PLATFORM) {
        throw new SocialConnectionError("account_limit");
      }
      // A declaration belongs to one account: the upgraded row's own, or — for the first account after a
      // disconnect — the platform's earlier declaration. Extra accounts carry none (no false mismatch).
      const declaredHandle =
        target?.declaredHandle ??
        (req.r.additional || active.length ? null : (rows.find((r) => r.declaredHandle)?.declaredHandle ?? null));
      const isPrimary = target?.isPrimary ?? !active.some((r) => r.isPrimary);

      const values = {
        externalAccountId: identity.externalAccountId,
        handle: identity.handle,
        declaredHandle,
        connectionStatus: "connected" as const,
        provider,
        connectedAt: now,
        disconnectedAt: null,
        accountCreatedAt: identity.accountCreatedAt,
        isPrimary,
      };
      let id: string;
      if (target) {
        await tx.update(creatorSocialAccounts).set(values).where(eq(creatorSocialAccounts.id, target.id));
        id = target.id;
      } else {
        const [row] = await tx
          .insert(creatorSocialAccounts)
          .values({ creatorId, platform: identity.platform, ...values })
          .returning({ id: creatorSocialAccounts.id });
        id = row!.id;
      }

      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.userId,
        eventType: "social.account_connected",
        entityType: "creator_social_account",
        entityId: id,
        metadata: { platform: identity.platform, provider, upgraded_declared: target?.connectionStatus === "declared" },
      });
      return id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "creator_social_accounts_external_account_key")) {
      throw new SocialConnectionError(
        "linked_elsewhere",
        "This account is already connected to another CreatorCo member.",
      );
    }
    if (isUniqueViolation(error, "creator_social_accounts_active_handle_key")) {
      throw new SocialConnectionError("linked_elsewhere", "You already have this account on your Passport.");
    }
    throw error;
  }

  const snapshotsStored = await ingestHistory(
    { ...deps, social },
    {
      userId: input.userId,
      accountId,
      platform: identity.platform,
      externalAccountId: identity.externalAccountId,
    },
  );
  const graph = await maybeRunGraph(deps.db, input.userId, creatorId, "connection", now);
  return { accountId, platform: identity.platform, handle: identity.handle, snapshotsStored, graphComputed: graph };
}

/** Fetches monthly history and stores it idempotently (re-fetching never duplicates). */
async function ingestHistory(
  deps: ConnectionDeps,
  input: { userId: string; accountId: string; platform: string; externalAccountId: string },
): Promise<number> {
  const history = await callProvider(
    deps.db,
    { userId: input.userId, provider: deps.social.descriptor, operation: "fetch_history" },
    () =>
      deps.social.fetchHistory({
        platform: input.platform,
        externalAccountId: input.externalAccountId,
        asOf: clock(deps),
        months: HISTORY_MONTHS,
      }),
    (r) => ({ outcome: r.length ? "success" : "not_found" }),
  );
  if (!history.length) return 0;
  const inserted = await deps.db
    .insert(creatorSocialSnapshots)
    .values(
      history.map((s) => ({
        socialAccountId: input.accountId,
        capturedAt: s.capturedAt,
        followers: s.followers,
        subscribers: s.subscribers,
        views: s.views,
        reach: s.reach,
        engagementRate: s.engagementRate === null ? null : String(s.engagementRate),
        postsCount: s.postsCount,
        rawPayloadRef: s.rawPayloadRef,
        source: "provider" as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: creatorSocialSnapshots.id });
  return inserted.length;
}

async function maybeRunGraph(
  db: Database,
  userId: string,
  creatorId: string,
  trigger: "connection" | "manual",
  now: Date,
) {
  if (!(await hasValidConsent(db, userId, CONSENT_KEYS.professionalAnalytics, now))) return false;
  const r = await runProfessionalGraph(db, { userId, creatorId, trigger, now });
  return r.ok;
}

/**
 * Disconnects a connected account. If the creator had declared this platform,
 * the row returns to "declared" with their declared handle, so the Passport
 * keeps showing it. Stored snapshots are retained (see README: retention
 * policy for disconnected-account history is an open decision).
 */
export async function disconnectAccount(deps: ConnectionDeps, input: { userId: string; accountId: string }) {
  const now = clock(deps);
  const creatorId = await completedProfileId(deps.db, input.userId);
  const [current] = await deps.db
    .select()
    .from(creatorSocialAccounts)
    .where(
      and(
        eq(creatorSocialAccounts.id, input.accountId),
        eq(creatorSocialAccounts.creatorId, creatorId),
        eq(creatorSocialAccounts.connectionStatus, "connected"),
      ),
    )
    .limit(1);
  if (!current) throw new SocialConnectionError("not_found");

  const revertToDeclared = current.declaredHandle !== null;
  await deps.db.transaction(async (tx) => {
    await tx
      .update(creatorSocialAccounts)
      .set(
        revertToDeclared
          ? {
              connectionStatus: "declared",
              handle: current.declaredHandle!,
              provider: SELF_DECLARED_PROVIDER,
              externalAccountId: null,
              connectedAt: null,
              accountCreatedAt: null,
              disconnectedAt: null,
            }
          : { connectionStatus: "disconnected", disconnectedAt: now, isPrimary: false },
      )
      .where(eq(creatorSocialAccounts.id, current.id));
    // Losing the primary account promotes the next one (connected first, then oldest).
    if (!revertToDeclared && current.isPrimary) {
      const [next] = await tx
        .select({ id: creatorSocialAccounts.id })
        .from(creatorSocialAccounts)
        .where(
          and(
            eq(creatorSocialAccounts.creatorId, creatorId),
            eq(creatorSocialAccounts.platform, current.platform),
            ne(creatorSocialAccounts.connectionStatus, "disconnected"),
          ),
        )
        .orderBy(
          sql`(${creatorSocialAccounts.connectionStatus} = 'connected') desc`,
          asc(creatorSocialAccounts.connectedAt),
        )
        .limit(1);
      if (next)
        await tx.update(creatorSocialAccounts).set({ isPrimary: true }).where(eq(creatorSocialAccounts.id, next.id));
    }
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "social.account_disconnected",
      entityType: "creator_social_account",
      entityId: current.id,
      metadata: { platform: current.platform, kept_declared: revertToDeclared },
    });
  });
  await maybeRunGraph(deps.db, input.userId, creatorId, "manual", now);
}

/** Re-fetches connected accounts and recomputes the graph (if analytics consent is on). */
export async function refreshConnectedAccounts(deps: ConnectionDeps, input: { userId: string }) {
  const creatorId = await completedProfileId(deps.db, input.userId);
  const accounts = await deps.db
    .select()
    .from(creatorSocialAccounts)
    .where(
      and(
        eq(creatorSocialAccounts.creatorId, creatorId),
        eq(creatorSocialAccounts.connectionStatus, "connected"),
        ne(creatorSocialAccounts.provider, SELF_DECLARED_PROVIDER),
      ),
    );
  let stored = 0;
  for (const a of accounts) {
    if (!a.externalAccountId) continue;
    stored += await ingestHistory(deps, {
      userId: input.userId,
      accountId: a.id,
      platform: a.platform,
      externalAccountId: a.externalAccountId,
    });
  }
  const graphComputed = await maybeRunGraph(deps.db, input.userId, creatorId, "manual", clock(deps));
  return { accounts: accounts.length, snapshotsStored: stored, graphComputed };
}

/** Turns on professional analytics later (separate consent) and computes the graph. */
export async function enableProfessionalAnalytics(
  db: Database,
  input: { userId: string; consentDefinitionId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const creatorId = await completedProfileId(db, input.userId);
  await grantConsent(db, {
    userId: input.userId,
    key: CONSENT_KEYS.professionalAnalytics,
    consentDefinitionId: input.consentDefinitionId,
    source: "settings",
    metadata: { surface: "passport" },
    now,
  });
  return runProfessionalGraph(db, { userId: input.userId, creatorId, trigger: "manual", now });
}

/** Makes a connected account the creator's primary one on its platform. */
export async function setPrimaryAccount(db: Database, input: { userId: string; accountId: string }) {
  const creatorId = await completedProfileId(db, input.userId);
  await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(creatorSocialAccounts)
      .where(
        and(
          eq(creatorSocialAccounts.id, input.accountId),
          eq(creatorSocialAccounts.creatorId, creatorId),
          eq(creatorSocialAccounts.connectionStatus, "connected"),
        ),
      )
      .for("update");
    if (!account) throw new SocialConnectionError("not_found");
    if (account.isPrimary) return;
    await tx
      .update(creatorSocialAccounts)
      .set({ isPrimary: false })
      .where(
        and(
          eq(creatorSocialAccounts.creatorId, creatorId),
          eq(creatorSocialAccounts.platform, account.platform),
          eq(creatorSocialAccounts.isPrimary, true),
        ),
      );
    await tx.update(creatorSocialAccounts).set({ isPrimary: true }).where(eq(creatorSocialAccounts.id, account.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "social.primary_account_changed",
      entityType: "creator_social_account",
      entityId: account.id,
      metadata: { platform: account.platform },
    });
  });
}
