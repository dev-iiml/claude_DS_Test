import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";

/** Stage 16: strict CSP and security headers, with no violations on real pages. */
test.describe("Web security", () => {
  test("pages carry a nonce CSP and run without violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text());
    });

    const res = await page.goto("/");
    const csp = res!.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}' 'strict-dynamic'/);
    expect(res!.headers()["x-frame-options"]).toBe("DENY");
    expect(res!.headers()["cross-origin-opener-policy"]).toBe("same-origin");

    // A fresh nonce per request.
    const again = await page.goto("/login");
    expect(again!.headers()["content-security-policy"]).not.toBe(csp);

    await signIn(page, "aarohi.menon@creators.creatorco.test");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/passport");
    await page.goto("/account/consents");
    expect(violations).toEqual([]);
  });

  test("protected pages redirect without a session; APIs deny framing and loading", async ({ page, request }) => {
    await page.goto("/ops");
    await expect(page).toHaveURL(/\/login\?next=%2Fops$/);
    const api = await request.get("/api/v1/health");
    expect(api.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  test("oversized API bodies are refused before they are read", async ({ request }) => {
    const res = await request.post("/api/v1/auth/sign-in", {
      data: JSON.stringify({ email: "x@example.com", password: "p".repeat(40_000), client: "ios" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(413);
  });
});
