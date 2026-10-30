import { expect, test } from "@playwright/test";

import { DEMO_PASSWORD, signIn } from "./helpers";

/** Seeded completed creator (see src/db/seed/demo.ts). */
const ISHITA = "ishita.rao@creators.creatorco.test";

test.describe("Underwriting Engine v0 (Stage 10)", () => {
  test("a ready check gets both recommendations; staff compare them in the risk console", async ({ page, request }) => {
    // Creator side, over the API: run a full check.
    const auth = await (
      await request.post("/api/v1/auth/sign-in", { data: { email: ISHITA, password: DEMO_PASSWORD, client: "ios" } })
    ).json();
    const h = { Authorization: `Bearer ${auth.token}` };
    const consent = await (await request.get("/api/v1/consents/financial_eligibility", { headers: h })).json();
    expect(consent.definition.version).toBe(4);
    const app = await (
      await request.post("/api/v1/eligibility", {
        headers: h,
        data: { consentDefinitionId: consent.definition.id, agree: true },
      })
    ).json();
    await request.put(`/api/v1/eligibility/${app.id}/details`, {
      headers: h,
      data: {
        purpose: "equipment",
        requestedAmount: 120000,
        declaredMonthlyIncome: 90000,
        declaredMonthlyEmi: 0,
        incomeSources: ["brand_deals", "platform_payouts"],
      },
    });
    await request.post(`/api/v1/eligibility/${app.id}/credit-check`, {
      headers: h,
      data: { pan: "ABCPE1237F", confirm: true },
    });
    const bank = await (
      await request.post(`/api/v1/eligibility/${app.id}/bank`, { headers: h, data: { mobile: "9876500011" } })
    ).json();
    const reference = new URL(bank.redirectUrl, "http://localhost").searchParams.get("reference");
    await request.post("/api/v1/eligibility/bank/complete", {
      headers: h,
      data: { params: { reference, status: "approved", accounts: "0011-0" } },
    });
    await request.put(`/api/v1/eligibility/${app.id}/bank/coverage`, { headers: h, data: { allShared: true } });
    await request.post(`/api/v1/eligibility/${app.id}/confirm`, { headers: h });
    const view = await (await request.get(`/api/v1/eligibility/${app.id}`, { headers: h })).json();
    expect(view.recommendation).toEqual({ prepared: true });
    // Creators don't receive figures before a partner lender has reviewed them.
    expect(JSON.stringify(view)).not.toMatch(/recommendedExposure|riskGrade/);

    // Staff side.
    await signIn(page, "risk.admin@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/underwriting");
    await expect(page.getByRole("heading", { level: 1, name: "Underwriting" })).toBeVisible();
    await expect(page.getByText(/not evidence of lower risk/)).toBeVisible();
    await page
      .getByRole("region", { name: "Recent runs" })
      .getByRole("link", { name: new RegExp(app.id.slice(0, 8)) })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Underwriting run" })).toBeVisible();
    await expect(page.getByText("Reproducible", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Traditional", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Creator-Enhanced" })).toBeVisible();
    await expect(page.getByText("BRAND_HISTORY_UNAVAILABLE").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Frozen inputs" })).toContainText("requested_amount");
    // Stage 11: the fraud layer is shown alongside, never to the creator.
    await expect(page.getByRole("heading", { name: /Fraud & authenticity/ })).toBeVisible();
    await expect(page.getByText("Same PAN on another account")).toBeVisible();
  });

  test("the same PAN on a second account is routed to review in the risk console", async ({ page, request }) => {
    const auth = await (
      await request.post("/api/v1/auth/sign-in", {
        data: { email: "dev.malhotra@creators.creatorco.test", password: DEMO_PASSWORD, client: "ios" },
      })
    ).json();
    const h = { Authorization: `Bearer ${auth.token}` };
    const consent = await (await request.get("/api/v1/consents/financial_eligibility", { headers: h })).json();
    const app = await (
      await request.post("/api/v1/eligibility", {
        headers: h,
        data: { consentDefinitionId: consent.definition.id, agree: true },
      })
    ).json();
    await request.put(`/api/v1/eligibility/${app.id}/details`, {
      headers: h,
      data: {
        purpose: "equipment",
        requestedAmount: 100000,
        declaredMonthlyIncome: 80000,
        declaredMonthlyEmi: 0,
        incomeSources: ["brand_deals"],
      },
    });
    // Same PAN Ishita used above.
    await request.post(`/api/v1/eligibility/${app.id}/credit-check`, {
      headers: h,
      data: { pan: "ABCPE1237F", confirm: true },
    });
    await request.post(`/api/v1/eligibility/${app.id}/bank/skip`, { headers: h });
    await request.post(`/api/v1/eligibility/${app.id}/confirm`, { headers: h });
    const view = await (await request.get(`/api/v1/eligibility/${app.id}`, { headers: h })).json();
    expect(view.recommendation).toEqual({ prepared: true });
    expect(JSON.stringify(view)).not.toMatch(/fraud|FRAUD|review/);

    await signIn(page, "risk.admin@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/underwriting");
    const row = page
      .getByRole("region", { name: "Recent runs" })
      .getByRole("link", { name: new RegExp(app.id.slice(0, 8)) });
    await expect(row).toContainText("Fraud review");
    await row.click();
    await expect(page.getByRole("heading", { level: 1, name: "Underwriting run" })).toBeVisible();
    await expect(page.getByText("Needs review")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Same PAN on another account" })).toContainText(
      "High severity",
    );
    await expect(page.getByText("FRAUD_REVIEW").first()).toBeVisible();
  });

  test("creators can't open the risk console", async ({ page }) => {
    await signIn(page, ISHITA);
    await expect(page).toHaveURL(/\/dashboard$/);
    const res = await page.goto("/admin/underwriting");
    expect(res?.status()).toBe(404);
  });
});
