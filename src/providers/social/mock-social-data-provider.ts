import { ProviderError } from "../errors";
import { stableHash, type ProviderHealth } from "../types";
import type { SocialAccountIdentity, SocialDataProvider, SocialMetricsSnapshot } from "./types";

/** Encodes what the mock authorisation screen "returns" (platform + handle the creator confirmed). */
export function encodeMockCode(input: { platform: string; handle: string; nonce: string }): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeMockCode(code: string): { platform: string; handle: string; nonce: string } {
  const parsed = JSON.parse(Buffer.from(code, "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof parsed.platform !== "string" || typeof parsed.handle !== "string" || typeof parsed.nonce !== "string") {
    throw new ProviderError("rejected", "invalid mock authorisation code");
  }
  return { platform: parsed.platform, handle: parsed.handle, nonce: parsed.nonce };
}

/** Demo flags carried in the mock account id so history generation can see them. */
const flag = (handle: string) => (/spike/i.test(handle) ? "-spike" : /steady/i.test(handle) ? "-steady" : "");

const startOfMonthUtc = (d: Date, monthsBack: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1));

/**
 * Deterministic mock social provider.
 * - Authorisation happens on CreatorCo's own `/connect/mock` screen (no network).
 * - The handle drives the data: the same handle always produces the same history.
 * - A handle containing "spike" produces a sudden follower jump (to exercise
 *   authenticity signals); "steady" produces very even growth.
 */
export class MockSocialDataProvider implements SocialDataProvider {
  readonly descriptor = { key: "mock", kind: "social", mode: "mock" } as const;

  constructor(private readonly authorizePath = "/connect/mock") {}

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  supportedPlatforms() {
    return ["instagram", "youtube", "linkedin", "x"] as const;
  }

  async beginConnection(input: { platform: string; state: string; redirectUri: string }) {
    const q = new URLSearchParams({ platform: input.platform, state: input.state, redirect_uri: input.redirectUri });
    return { authorizationUrl: `${this.authorizePath}?${q.toString()}` };
  }

  async completeConnection(input: { platform: string; code: string }): Promise<SocialAccountIdentity> {
    const c = decodeMockCode(input.code);
    if (c.platform !== input.platform)
      throw new ProviderError("rejected", "mock code was issued for a different platform");
    const h = stableHash(`${c.platform}:${c.handle.toLowerCase()}`);
    const yearsOld = 2 + (h % 6); // 2–7 years
    return {
      platform: c.platform,
      externalAccountId: `mock-${c.platform}-${h.toString(36)}${flag(c.handle)}`,
      handle: c.handle,
      accountCreatedAt: new Date(Date.UTC(2026 - yearsOld, h % 12, 1 + (h % 27))),
    };
  }

  async fetchHistory(input: { platform: string; externalAccountId: string; asOf: Date; months: number }) {
    const h = stableHash(input.externalAccountId);
    const steady = input.externalAccountId.includes("steady");
    const base = 8_000 + (h % 180_000);
    const monthlyGrowth = 0.01 + (h % 50) / 1_000; // 1%–6%
    const engagementBase = 0.015 + (h % 40) / 1_000;
    const postsPerMonth = 4 + (h % 18);
    const spikeAt = input.externalAccountId.includes("spike") ? input.months - 3 : -1;

    const out: SocialMetricsSnapshot[] = [];
    let followers = base;
    let posts = 120 + (h % 400);
    for (let i = 0; i < input.months; i++) {
      const wobble = steady ? 0 : (((h >> (i % 20)) % 21) - 10) / 1_000; // ±1%
      followers = Math.round(followers * (1 + monthlyGrowth + wobble));
      if (i === spikeAt) followers = Math.round(followers * 1.8);
      const skipMonth = !steady && (h + i) % 9 === 0;
      posts += skipMonth ? 0 : postsPerMonth + ((h >> i) % 3);
      const engagement = engagementBase + (steady ? 0 : (((h >> (i % 16)) % 11) - 5) / 2_000);
      const isVideo = input.platform === "youtube";
      out.push({
        capturedAt: startOfMonthUtc(input.asOf, input.months - 1 - i),
        followers: isVideo ? null : followers,
        subscribers: isVideo ? followers : null,
        views: Math.round(followers * (isVideo ? 9 : 3.5)),
        reach: Math.round(followers * 0.6),
        engagementRate: Number(Math.max(0.001, engagement).toFixed(6)),
        postsCount: posts,
        rawPayloadRef: null,
      });
    }
    return out;
  }
}
