import type { Provider } from "../types";

export interface SocialAccountIdentity {
  platform: string;
  externalAccountId: string;
  handle: string;
  accountCreatedAt: Date | null;
}

/** Normalised metrics; maps onto `creator_social_snapshots`. Raw payloads stay with the provider. */
export interface SocialMetricsSnapshot {
  capturedAt: Date;
  followers: number | null;
  subscribers: number | null;
  views: number | null;
  reach: number | null;
  engagementRate: number | null;
  /** Cumulative post count at capture time. */
  postsCount: number | null;
  /** Pointer to restricted raw storage, if retention is approved. */
  rawPayloadRef: string | null;
}

/**
 * Creator-authorised social data access (OAuth-style). CreatorCo generates
 * and verifies `state`; the provider only echoes it back.
 */
export interface SocialDataProvider extends Provider {
  supportedPlatforms(): readonly string[];
  beginConnection(input: {
    platform: string;
    state: string;
    redirectUri: string;
  }): Promise<{ authorizationUrl: string }>;
  completeConnection(input: { platform: string; code: string }): Promise<SocialAccountIdentity>;
  /** Monthly snapshots, oldest first, ending at `asOf`. */
  fetchHistory(input: {
    platform: string;
    externalAccountId: string;
    asOf: Date;
    months: number;
  }): Promise<SocialMetricsSnapshot[]>;
}
