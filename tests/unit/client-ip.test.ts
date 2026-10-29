import { afterEach, describe, expect, it, vi } from "vitest";

/** Stage 16 review: which address the rate limiter counts. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.doMock("next/headers", () => ({ headers: async () => new Headers() }));
  return import("@/app/_lib/rate-limit");
}
const h = (xff: string) => new Headers({ "x-forwarded-for": xff });

describe("client IP for rate limits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("next/headers");
  });

  it("edge-overwritten header (Vercel): first entry", async () => {
    const { clientIpFrom } = await load({ APP_ENV: "test" });
    expect(clientIpFrom(h("203.0.113.7"))).toBe("203.0.113.7");
    expect(clientIpFrom(h("203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("appending proxies: the trusted hop from the right, ignoring spoofed entries", async () => {
    const { clientIpFrom } = await load({ APP_ENV: "test", CLIENT_IP_TRUSTED_HOPS: "1" });
    expect(clientIpFrom(h("6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("rejects junk and counts IPv6 per /64", async () => {
    const { clientIpFrom } = await load({ APP_ENV: "test" });
    expect(clientIpFrom(h("aaaa"))).toBeNull();
    expect(clientIpFrom(new Headers())).toBeNull();
    expect(clientIpFrom(h("2001:db8:1:2:aaaa::1"))).toBe("2001:db8:1:2::/64");
    expect(clientIpFrom(h("2001:db8:1:2:bbbb:cccc:dddd:eeee"))).toBe("2001:db8:1:2::/64");
    expect(clientIpFrom(h("::ffff:203.0.113.7"))).toBe("203.0.113.7");
  });
});
