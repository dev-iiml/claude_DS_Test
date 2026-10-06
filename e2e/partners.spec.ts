import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { signIn } from "./helpers";

const MAKER = "ops.admin@staff.creatorco.test";
const CHECKER = "ops.approver@staff.creatorco.test";
/** Seeded, public, sandbox-only key (src/db/seed/demo.ts). */
const DEMO_KEY = `cck_test_sandbox1_${"DemoOnlySandboxPartnerKey_NotASecret".padEnd(43, "x")}`;

async function asUser(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/ops$/);
  return page;
}

async function openSandboxPartner(page: Page) {
  await page.goto("/ops/partners");
  await page.getByRole("link", { name: /Sandbox Partner Lender/ }).click();
  await expect(page.getByRole("heading", { name: "Sandbox Partner Lender", level: 1 })).toBeVisible();
}

function verify(header: string | undefined, body: string, secret: string) {
  const parts = (header ?? "").split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2) ?? "";
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3), "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

test.describe("partner API (Stage 12b)", () => {
  test.describe.configure({ mode: "serial" });

  test("partner endpoints need a partner key; the seeded sandbox key works", async ({ request }) => {
    expect((await request.get("/api/partner/v1/ping")).status()).toBe(401);
    expect(
      (
        await request.get("/api/partner/v1/ping", { headers: { Authorization: "Bearer cck_test_nope_short" } })
      ).status(),
    ).toBe(401);
    const h = { Authorization: `Bearer ${DEMO_KEY}` };
    const ping = await request.get("/api/partner/v1/ping", { headers: h });
    expect(ping.status()).toBe(200);
    expect(ping.headers()["cache-control"]).toBe("no-store");
    expect(await ping.json()).toMatchObject({
      partner: "partner_sandbox",
      environment: "sandbox",
      key: "cck_test_sandbox1",
    });

    const list = await request.get("/api/partner/v1/proposals?status=awaiting_decision", { headers: h });
    expect(list.status()).toBe(200);
    expect(await list.json()).toMatchObject({ data: expect.any(Array), nextCursor: null });
    expect((await request.get("/api/partner/v1/proposals?status=bogus", { headers: h })).status()).toBe(422);
    expect(
      (await request.get("/api/partner/v1/proposals/00000000-0000-4000-8000-000000000000", { headers: h })).status(),
    ).toBe(404);
    expect((await request.get("/api/partner/v1/events", { headers: h })).status()).toBe(200);

    const noKey = await request.post("/api/partner/v1/proposals/00000000-0000-4000-8000-000000000000/decision", {
      headers: h,
      data: { outcome: "declined" },
    });
    expect(noKey.status()).toBe(400);
    expect((await noKey.json()).error.code).toBe("idempotency_key_required");
    const missing = await request.post("/api/partner/v1/proposals/00000000-0000-4000-8000-000000000000/decision", {
      headers: { ...h, "Idempotency-Key": "e2e-decision-1" },
      data: { outcome: "declined" },
    });
    expect(missing.status()).toBe(404);
    // Creator bearer tokens and cookies are not partner credentials.
    expect(
      (
        await request.get("/api/partner/v1/ping", {
          headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" },
        })
      ).status(),
    ).toBe(401);
  });

  test("a key needs a second ops admin, is shown once, and revocation is immediate", async ({ browser, request }) => {
    const maker = await asUser(browser, MAKER);
    await openSandboxPartner(maker);
    await maker.getByLabel("Label").fill("E2E decision service");
    await maker.getByRole("button", { name: "Issue key" }).click();
    const secret = maker.getByTestId("one-time-secret");
    await expect(secret).toBeVisible();
    const key = (await secret.locator("code").innerText()).trim();
    expect(key).toMatch(/^cck_test_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const h = { Authorization: `Bearer ${key}` };
    expect((await request.get("/api/partner/v1/ping", { headers: h })).status()).toBe(401); // pending

    await maker.reload();
    await expect(maker.getByText("You proposed this — another ops admin must approve it.")).toBeVisible();
    await expect(maker.getByText(key)).toHaveCount(0); // never shown again

    const checker = await asUser(browser, CHECKER);
    await openSandboxPartner(checker);
    const row = checker.getByRole("listitem").filter({ hasText: "E2E decision service" });
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(
      checker.getByRole("listitem").filter({ hasText: "E2E decision service" }).getByText("active", { exact: true }),
    ).toBeVisible();
    expect((await request.get("/api/partner/v1/ping", { headers: h })).status()).toBe(200);

    const active = checker.getByRole("listitem").filter({ hasText: "E2E decision service" });
    await active.getByPlaceholder("Reason (required)").fill("E2E rotation drill");
    await active.getByRole("button", { name: "Revoke now" }).click();
    await expect(
      checker.getByRole("listitem").filter({ hasText: "E2E decision service" }).getByText("revoked", { exact: true }),
    ).toBeVisible();
    expect((await request.get("/api/partner/v1/ping", { headers: h })).status()).toBe(401);
  });

  test("a webhook URL needs approval; test events arrive signed and thin @mobile", async ({ browser }) => {
    const received: { headers: IncomingHttpHeaders; body: string }[] = [];
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const maker = await asUser(browser, MAKER);
      await openSandboxPartner(maker);
      await maker.getByLabel(/Webhook URL/).fill(`http://127.0.0.1:${port}/hooks`);
      await maker.getByRole("button", { name: "Propose URL" }).click();
      const secret = (await maker.getByTestId("one-time-secret").locator("code").innerText()).trim();
      expect(secret).toMatch(/^whsec_/);

      const checker = await asUser(browser, CHECKER);
      await openSandboxPartner(checker);
      await checker
        .getByRole("listitem")
        .filter({ hasText: `127.0.0.1:${port}` })
        .getByRole("button", { name: "Approve" })
        .click();
      await expect(checker.getByText("Active", { exact: true })).toBeVisible();
      await checker.getByRole("button", { name: "Send test event" }).click();
      await expect(checker.getByText(/Test event queued/)).toBeVisible();
      await expect.poll(() => received.length).toBeGreaterThan(0);
      const [hit] = received;
      const event = JSON.parse(hit!.body);
      expect(event).toMatchObject({ type: "ping", data: {} });
      expect(hit!.headers["creatorco-event-id"]).toBe(event.id);
      expect(verify(hit!.headers["creatorco-signature"] as string, hit!.body, secret)).toBe(true);
      await expect(
        checker.getByRole("listitem").filter({ hasText: "ping" }).first().getByText("delivered", { exact: true }),
      ).toBeVisible();

      // Stop deliveries (instant) so later runs start clean.
      await checker.getByRole("button", { name: "Stop deliveries" }).click();
      await expect(checker.getByText("No active webhook URL")).toBeVisible();
    } finally {
      server.close();
    }
  });
});
