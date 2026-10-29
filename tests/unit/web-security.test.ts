import { describe, expect, it } from "vitest";

import { API_CSP, contentSecurityPolicy, generateNonce } from "@/lib/csp";
import { isProtectedPath } from "@/proxy";

describe("content security policy", () => {
  const prod = contentSecurityPolicy({ nonce: "abc123==", dev: false, secure: true });

  it("only our own nonced scripts run; no eval, framing, plugins or third parties", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(prod).not.toMatch(/unsafe-eval|unsafe-inline'[^;]*script|https?:\/\/|\*/);
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("dev adds only what next dev needs; http test runs don't upgrade", () => {
    const dev = contentSecurityPolicy({ nonce: "n", dev: true, secure: false });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self' ws: wss:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("nonces are fresh 128-bit values", () => {
    const a = generateNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(generateNonce()).not.toBe(a);
  });

  it("APIs deny everything", () => {
    expect(API_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe("protected paths", () => {
  it.each(["/dashboard", "/ops/jobs", "/eligibility/x/review", "/paused", "/insights"])("%s needs a session", (p) =>
    expect(isProtectedPath(p)).toBe(true),
  );
  it.each(["/", "/login", "/signup", "/opsx", "/pausedness"])("%s is public", (p) =>
    expect(isProtectedPath(p)).toBe(false),
  );
});
