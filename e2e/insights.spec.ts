import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { E2E_PASSWORD, signIn, signUp, uniqueEmail } from "./helpers";

test.describe("analytics (Stage 15)", () => {
  test("analysts see aggregate dashboards only; risk admins reach them from the risk console", async ({ page }) => {
    await signIn(page, "analyst@staff.creatorco.test");
    await expect(page).toHaveURL(/\/insights$/);
    await expect(page.getByRole("heading", { level: 1, name: "Creator funnel" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Funnel" })).toContainText("Account created");
    await page.getByRole("link", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/days=7/);
    await page.goto("/insights/models");
    await expect(page.getByRole("heading", { level: 1, name: "Model analytics" })).toBeVisible();
    await expect(page.getByText(/nothing here shows lower default risk/)).toBeVisible();
    for (const path of ["/admin", "/partnerships", "/ops"]) expect((await page.goto(path))?.status()).toBe(404);

    const risk = await page.context().browser()!.newContext();
    const r = await risk.newPage();
    await signIn(r, "risk.admin@staff.creatorco.test");
    await r.getByRole("link", { name: "Analytics" }).first().click();
    await expect(r).toHaveURL(/\/insights$/);
    await expect(r.getByRole("link", { name: "Risk console" }).first()).toBeVisible();
    await risk.close();
  });

  test("creators can't open insights; a native app's screen views need the optional consent", async ({
    page,
    request,
  }) => {
    await signIn(page, "aarohi.menon@creators.creatorco.test");
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await page.goto("/insights"))?.status()).toBe(404);
    await page.goto("/account/consents");
    await expect(page.getByRole("region", { name: "Service measurement" })).toContainText("pseudonymous ID");
    await expect(page.getByRole("link", { name: /Product analytics/ })).toBeVisible();

    const up = await request.post("/api/v1/auth/sign-up", {
      data: { email: uniqueEmail("events"), password: E2E_PASSWORD, confirmPassword: E2E_PASSWORD, client: "ios" },
    });
    const { token } = (await up.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    const view = { event: "offer_viewed", props: { simulated: true } };
    const res = await request.post("/api/v1/events", { headers, data: view });
    expect(res.status()).toBe(202);
    expect(await res.json()).toEqual({ recorded: false });
    expect(
      (await request.post("/api/v1/events", { headers, data: { event: "account_created", props: {} } })).status(),
    ).toBe(422);
    expect(
      (
        await request.post("/api/v1/events", { headers, data: { event: "offer_viewed", props: { amount: 1 } } })
      ).status(),
    ).toBe(422);
    const consents = await (await request.get("/api/v1/consents", { headers })).json();
    expect(consents.serviceMeasurement).toMatch(/pseudonymous ID/);
  });

  test("sign-ups remember the campaign they came from (reviewed values only, no identifiers)", async ({ page }) => {
    const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
    const count = async () =>
      (
        await sql`select count(*)::int as n from analytics.events
          where event = 'account_created' and props @> ${sql.json({
            utm_source: "instagram",
            utm_medium: "other",
            utm_campaign: "e2e_launch",
            referrer: null,
          })}`
      )[0]!.n as number;
    try {
      const before = await count();
      // "e2e_launch" is registered (playwright.config.ts); a free-text medium is reduced to "other".
      await page.goto("/?utm_source=Instagram&utm_medium=Aarohi+Menon&utm_campaign=e2e_launch&utm_content=x");
      const cookie = (await page.context().cookies()).find((c) => c.name === "cc_attr");
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
      expect(decodeURIComponent(cookie!.value)).toBe("utm_source=instagram&utm_medium=other&utm_campaign=e2e_launch");
      await signUp(page, uniqueEmail("utm"));
      expect((await page.context().cookies()).some((c) => c.name === "cc_attr")).toBe(false);
      expect(await count()).toBe(before + 1);
    } finally {
      await sql.end();
    }
  });
});
