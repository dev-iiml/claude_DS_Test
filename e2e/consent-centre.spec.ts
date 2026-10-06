import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";

/** Seeded completed creator with no optional consents (see src/db/seed/demo.ts). */
const DEV = "dev.malhotra@creators.creatorco.test";

async function signInAsDev(page: Page) {
  await signIn(page, DEV);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("consent centre (Stage 08)", () => {
  test.describe.configure({ mode: "serial" });

  test("gives, inspects and withdraws an optional consent with receipts", async ({ page }) => {
    await signInAsDev(page);
    await page.goto("/account");
    await page.getByRole("link", { name: /Consent centre/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Consent centre" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Membership" }).getByRole("link", { name: /Creator Professional Profile/ }),
    ).toContainText("On");
    const signals = page.getByRole("region", { name: "Optional" }).getByRole("link", { name: /Professional signals/ });
    await expect(signals).toContainText("Not given");

    await signals.click();
    await expect(page.getByRole("heading", { level: 1, name: "Professional signals" })).toBeVisible();
    await page.getByRole("button", { name: "Give consent" }).click();
    await expect(page.getByText("Tick the box to give this consent.").first()).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree to this consent/ }).check();
    await page.getByRole("button", { name: "Give consent" }).click();
    await expect(page).toHaveURL(/\/account\/consents\/professional_analytics\?granted=1$/);
    await expect(page.getByText("Consent recorded.")).toBeVisible();

    await page
      .getByRole("region", { name: "Your receipts" })
      .getByRole("link", { name: /Version 1 · Given/ })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Consent receipt" })).toBeVisible();
    await expect(page.getByText("In force")).toBeVisible();
    await expect(page.getByRole("region", { name: "Text fingerprint" }).getByText(/^[0-9a-f]{64}$/)).toBeVisible();

    await page.goto("/account/consents/professional_analytics");
    await page.getByRole("link", { name: /Withdraw consent/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Withdraw consent?" })).toBeVisible();
    await expect(page.getByText(/Signals already computed are erased/)).toBeVisible();
    await expect(page.getByText(/partner lender/).first()).toBeVisible();
    await page.getByRole("radio", { name: "Privacy concerns" }).check();
    await page.getByRole("button", { name: "Withdraw consent" }).click();
    await expect(page).toHaveURL(/withdrawn=1$/);
    await expect(page.getByText("Consent withdrawn.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Your receipts" }).getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Your receipts" })).toContainText("Withdrawn");
  });

  test("withdrawing the Creator Profile consent pauses membership until re-consent", async ({ page }) => {
    await signInAsDev(page);
    await page.goto("/account/consents/creator_profile/withdraw");
    await expect(page.getByRole("heading", { level: 1, name: "Pause membership?" })).toBeVisible();
    await page.getByRole("button", { name: "Pause membership" }).click();

    await expect(page).toHaveURL(/\/paused$/);
    await expect(page.getByRole("heading", { level: 1, name: "Your membership is paused" })).toBeVisible();
    for (const path of ["/dashboard", "/passport", "/access"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/paused$/);
    }
    // The consent centre stays open while paused.
    await page.goto("/account/consents");
    await expect(page.getByRole("heading", { level: 1, name: "Consent centre" })).toBeVisible();

    await page.goto("/paused");
    await page.getByRole("link", { name: "Resume membership" }).click();
    await page.getByRole("checkbox", { name: /I agree to this consent/ }).check();
    await page.getByRole("button", { name: "Resume membership" }).click();
    await expect(page).toHaveURL(/\/account\/consents\/creator_profile\?granted=1$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
