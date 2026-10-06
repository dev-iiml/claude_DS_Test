/**
 * Social-account vocabulary.
 *
 * `declared` = the creator told us they use the platform (self-reported).
 * `connected` = a SocialDataProvider has verified access. Keeping both lets
 * later stages compare declared vs verified data (a useful authenticity signal).
 */
export const CONNECTION_STATUSES = ["declared", "pending", "connected", "error", "disconnected"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** Provider key used for self-reported accounts. Vendor names never appear in core columns. */
export const SELF_DECLARED_PROVIDER = "self_declared";

/**
 * A creator may connect several accounts on one platform (e.g. a main and a
 * niche channel). Capped to keep one person from padding their Passport;
 * one account per platform is marked primary (shown first, used for display).
 */
export const MAX_ACCOUNTS_PER_PLATFORM = 3;

export const SNAPSHOT_SOURCES = ["provider", "manual"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];
