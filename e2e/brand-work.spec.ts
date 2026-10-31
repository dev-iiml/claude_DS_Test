import { expect, test, type APIRequestContext } from "@playwright/test";

import { E2E_PASSWORD, signIn, uniqueEmail } from "./helpers";

const REVIEWER = "brand.reviewer@staff.creatorco.test";
const PARTNERSHIPS = "partnerships.admin@staff.creatorco.test";

/** A fresh member, onboarded over the API (so no demo creator's state is touched). */
async function newMember(request: APIRequestContext, displayName: string) {
  const email = uniqueEmail("brandwork");
  const up = await request.post("/api/v1/auth/sign-up", {
    data: { email, password: E2E_PASSWORD, confirmPassword: E2E_PASSWORD, client: "ios" },
  });
  const { token } = (await up.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const steps: [string, unknown][] = [
    ["about", { legalName: "Isha Brandwork", displayName, state: "Karnataka", city: "Bengaluru", languages: ["en"] }],
    [
      "profile",
      {
        primaryCreatorHandle: `isha.${Date.now().toString(36)}.demo`,
        categories: ["beauty"],
        primaryCategory: "beauty",
        creatorSince: "2020-01",
        platforms: ["instagram"],
      },
    ],
    ["business", { legalForm: "individual", gstStatus: "not_registered" }],
    ["interests", { prInterest: true, preferredCategories: ["beauty"], brandInterests: [], travelInterest: false }],
  ];
  for (const [step, data] of steps) {
    const r = await request.put(`/api/v1/onboarding/${step}`, { headers, data });
    expect(r.status(), step).toBe(204);
  }
  const consent = await (await request.get("/api/v1/consents/creator_profile", { headers })).json();
  const done = await request.post("/api/v1/onboarding/complete", {
    headers,
    data: { consentDefinitionId: consent.definition.id, agree: true },
  });
  expect(done.status()).toBe(204);
  return { email, headers };
}

/** A tiny fictional PDF, unique per run so its hash never matches another record's. */
const samplePdf = () => Buffer.from(`%PDF-1.4\n% fictional e2e invoice ${Date.now()}-${Math.random()}\n%%EOF\n`);

test.describe("Verified brand work (Stage 18)", () => {
  test("a creator adds work and a document; a reviewer verifies it; points appear", async ({
    page,
    request,
    browser,
  }) => {
    const displayName = `Isha ${Date.now().toString(36)}`;
    const brand = `Fictional Glow ${Date.now().toString(36)}`;
    const m = await newMember(request, displayName);

    await signIn(page, m.email, E2E_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/passport/brand-work");
    await page.getByRole("link", { name: "Add brand work" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Add brand work" })).toBeVisible();
    await page.getByLabel("Brand", { exact: true }).fill(brand);
    await page.getByRole("radio", { name: "The brand directly" }).check();
    await page.getByRole("checkbox", { name: "Instagram" }).check();
    await page.getByRole("checkbox", { name: "Reel", exact: true }).check();
    await page.getByLabel("What was the work?").fill("Two reels for a fictional skincare launch");
    await page.getByLabel("When was the work?").fill("2026-06-01");
    await page.getByLabel("Invoice date").fill("2026-06-05");
    await page.getByLabel("Invoice amount (₹)").fill("40000");
    await page.getByRole("checkbox", { name: /I agree to CreatorCo storing and verifying/ }).check();
    await page.getByRole("button", { name: "Save and add documents" }).click();

    await expect(page.getByRole("heading", { level: 1, name: brand })).toBeVisible();
    const recordUrl = page.url();
    await page.locator('input[type="file"][name="file"]').setInputFiles({
      name: "invoice.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf(),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("No documents yet")).toBeHidden();
    await page.getByRole("button", { name: "Send for verification" }).click();
    await expect(page.getByText("In review").first()).toBeVisible();

    // The reviewer (a separate, least-privilege role) verifies it.
    const staff = await browser.newPage();
    await signIn(staff, REVIEWER);
    await expect(staff).toHaveURL(/\/brand-work$/);
    await staff
      .getByRole("link", { name: new RegExp(brand) })
      .first()
      .click();
    await staff.getByLabel("Or add a new brand").fill(brand);
    await staff.getByLabel("Industry", { exact: true }).selectOption("beauty_personal_care");
    await staff.getByRole("button", { name: "Confirm brand and industry" }).click();
    await staff.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(staff.getByText("Verified").first()).toBeVisible();
    await staff.close();

    // Back with the creator: verified, the milestone points, and payment options with equal weight.
    await page.goto(recordUrl);
    await expect(page.getByText("Verified").first()).toBeVisible();
    const options = page.getByRole("radio", {
      name: /My agency can confirm|Upload remittance advice|Check my shared bank data/,
    });
    // The bank-data option is hidden while the brand_payment_match switch is off (the default).
    await expect(options).toHaveCount(2);
    await expect(page.getByRole("radio", { name: "Check my shared bank data" })).toHaveCount(0);
    for (let i = 0; i < 2; i++) await expect(options.nth(i)).not.toBeChecked();
    const classes = await page.locator("fieldset label").evaluateAll((els) => els.map((e) => e.className));
    expect(new Set(classes).size).toBe(1);

    await page.goto("/access/points");
    await expect(page.getByText("First verified brand work").first()).toBeVisible();
    await expect(page.getByText("1,000").first()).toBeVisible(); // 750 + 250
  });

  test("only brand-work reviewers (and super admins) reach the review desk", async ({ page, browser }) => {
    await signIn(page, PARTNERSHIPS);
    await expect(page).toHaveURL(/\/partnerships$/);
    const denied = await page.goto("/brand-work");
    expect(denied!.status()).toBe(404);

    const reviewer = await browser.newPage();
    await signIn(reviewer, REVIEWER);
    await expect(reviewer).toHaveURL(/\/brand-work$/);
    for (const path of ["/brand-work", "/brand-work/reversals", "/brand-work/directory"]) {
      const res = await reviewer.goto(path);
      expect(res!.status(), path).toBe(200);
    }
    for (const path of ["/admin", "/ops", "/partnerships", "/insights"]) {
      const res = await reviewer.goto(path);
      expect([403, 404].includes(res!.status()) || !reviewer.url().endsWith(path), path).toBe(true);
    }
    await reviewer.close();
  });
});
