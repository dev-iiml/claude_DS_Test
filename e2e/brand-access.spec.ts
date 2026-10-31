import { expect, test, type APIRequestContext } from "@playwright/test";

import { E2E_PASSWORD, signIn, uniqueEmail } from "./helpers";

const PARTNERSHIPS = "partnerships.admin@staff.creatorco.test";

/** A fresh member, onboarded over the API (so no demo creator's state is touched). */
async function newMember(request: APIRequestContext, displayName: string) {
  const email = uniqueEmail("access");
  const up = await request.post("/api/v1/auth/sign-up", {
    data: { email, password: E2E_PASSWORD, confirmPassword: E2E_PASSWORD, client: "ios" },
  });
  const { token } = (await up.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const steps: [string, unknown][] = [
    ["about", { legalName: "Rhea Access", displayName, state: "Karnataka", city: "Bengaluru", languages: ["en"] }],
    [
      "profile",
      {
        primaryCreatorHandle: `rhea.${Date.now().toString(36)}.demo`,
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

test.describe("Access preview and Creator Points (Stage 14)", () => {
  test("a member requests an opportunity with points; the partnerships desk approves it", async ({
    page,
    request,
    browser,
  }) => {
    const displayName = `Rhea ${Date.now().toString(36)}`;
    const m = await newMember(request, displayName);

    await signIn(page, m.email, E2E_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("750 points available")).toBeVisible(); // welcome 500 + profile details 250
    await expect(page.getByRole("link", { name: /Luxury Beauty Drop/ })).toBeVisible();

    // Creator Status: Member until signals exist; never a credit input.
    await page.goto("/passport/status");
    await expect(page.getByRole("heading", { level: 1, name: "Creator Status" })).toBeVisible();
    await expect(page.getByText(/never affects financial eligibility/)).toBeVisible();
    await expect(page.getByRole("region", { name: "What Onyx looks for" })).toContainText("Professional reach");

    // Filters: search, then "You can request" hides tier-locked items.
    await page.goto("/access");
    await page.getByLabel("Search").fill("Camera");
    await page.getByRole("button", { name: "Apply" }).click();
    const opportunities = page.getByRole("list", { name: "Opportunities" });
    await expect(opportunities.getByRole("link", { name: /Camera Creator Programme/ })).toContainText("Onyx+ only");
    await page.getByLabel("Show").selectOption("available");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Nothing matches these filters")).toBeVisible();
    await page.goto("/access?q=Luxury&sort=points_low");
    await opportunities.getByRole("link", { name: /Luxury Beauty Drop/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Luxury Beauty Drop" })).toBeVisible();
    await page.getByLabel(/Note to the brand team/).fill("Autumn skincare fits my routine videos.");
    await page.getByRole("button", { name: "Request access" }).click();
    await expect(page.getByText("Agree to the brand opportunities consent to request access.")).toBeVisible();
    await page.getByRole("checkbox", { name: /considering my requests for brand opportunities/ }).check();
    await page.getByRole("button", { name: "Request access" }).click();
    await expect(page.getByText(/Request sent/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Your request" })).toContainText("300 points");

    const access = await (await request.get("/api/v1/access", { headers: m.headers })).json();
    expect(access.points).toEqual({ balance: 450, onHold: 300 });
    const consent = await (await request.get("/api/v1/consents/brand_opportunities", { headers: m.headers })).json();
    expect(consent.granted).toBe(true);

    await page.goto("/access/points");
    await expect(page.getByText("Held for Luxury Beauty Drop")).toBeVisible();
    await expect(page.getByText("Creator Points have no cash value")).toBeVisible();

    // The partnerships desk (its own console, its own role).
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    await signIn(staff, PARTNERSHIPS);
    await expect(staff).toHaveURL(/\/partnerships$/);
    await staff.getByRole("link", { name: new RegExp(`${displayName} · Luxury Beauty Drop`) }).click();
    await expect(staff.getByRole("region", { name: "Note from the creator" })).toContainText("Autumn skincare");
    await expect(staff.getByRole("region", { name: "Creator", exact: true })).toContainText("No financial data");
    await staff.getByRole("button", { name: "Approve request" }).click();
    await expect(staff.getByText(/Approved\. The creator sees it/)).toBeVisible();
    expect((await staff.goto("/admin"))?.status()).toBe(404);
    await staffContext.close();

    await page.goto("/access");
    await expect(page.getByRole("region", { name: "Your requests" })).toContainText("Approved");
    const after = await (await request.get("/api/v1/points", { headers: m.headers })).json();
    expect(after).toMatchObject({ balance: 450, onHold: 0, rulesVersion: "pts-0.2.0" });
    expect(after.history[0]).toMatchObject({ type: "spent", amount: -300 });
  });

  test("other staff can't reach the partnerships desk", async ({ page }) => {
    await signIn(page, "risk.admin@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    expect((await page.goto("/partnerships"))?.status()).toBe(404);
  });
});
