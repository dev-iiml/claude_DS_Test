import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";

/** Seeded completed creator who declared Instagram and YouTube (see src/db/seed/demo.ts). */
const KABIR = "kabir.sethi@creators.creatorco.test";

async function signInAsKabir(page: Page) {
  await signIn(page, KABIR);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("Creator Passport, social connection and professional signals", () => {
  test.describe.configure({ mode: "serial" });

  test("connects an account through the mock provider with separate consents", async ({ page }) => {
    await signInAsKabir(page);

    await page.goto("/passport");
    await expect(page.getByRole("heading", { level: 1, name: "Passport" })).toBeVisible();
    const accounts = page.getByRole("region", { name: "Social accounts" });
    await expect(accounts.getByText("@kabir.ontheroad.demo · self-declared")).toHaveCount(2);
    await expect(
      page.getByRole("region", { name: "Verification" }).getByText("Self-declared — connect an account to verify"),
    ).toBeVisible();

    await accounts.getByRole("link", { name: "Connect Instagram" }).click();
    await expect(page).toHaveURL(/\/passport\/connect\?platform=instagram$/);
    await expect(page.getByRole("heading", { level: 1, name: "Connect Instagram" })).toBeVisible();
    await expect(page.getByText("Connect a creator account")).toBeVisible();

    await page.getByRole("button", { name: "Continue to Instagram" }).click();
    await expect(page.getByText("Please confirm to continue.").first()).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree to connect this account/ }).check();
    await page.getByRole("switch", { name: /Also turn on professional signals/ }).check();
    await page.getByRole("button", { name: "Continue to Instagram" }).click();

    await expect(page).toHaveURL(/\/connect\/mock\?/);
    await expect(page.getByText("Test connection — simulated platform")).toBeVisible();
    await expect(page.getByLabel("Account handle")).toHaveValue("kabir.ontheroad.demo");
    await page.getByRole("button", { name: "Allow" }).click();

    await expect(page).toHaveURL(/\/passport\?connected=instagram$/);
    await expect(page.getByText("Account connected.")).toBeVisible();
    await expect(accounts.getByRole("link", { name: /^Instagram/ })).toContainText("Connected");
    await expect(page.getByRole("region", { name: "Verification" }).getByText("1 connected account")).toBeVisible();
    const signals = page.getByRole("region", { name: "Professional signals" });
    await expect(signals.getByText("Creating for")).toBeVisible();
    await expect(signals.getByText(/not a credit score/)).toBeVisible();
    await expect(page.locator("main")).not.toContainText("₹");
  });

  test("adds a second Instagram account and switches the primary one", async ({ page }) => {
    await signInAsKabir(page);
    await page.goto("/passport");
    const accounts = page.getByRole("region", { name: "Social accounts" });
    await accounts.getByRole("link", { name: "Add another Instagram account" }).click();
    await expect(page).toHaveURL(/platform=instagram&additional=1$/);
    await expect(page.getByRole("heading", { level: 1, name: "Add another Instagram account" })).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree to connect this account/ }).check();
    await page.getByRole("button", { name: "Continue to Instagram" }).click();
    await expect(page).toHaveURL(/\/connect\/mock\?/);
    // No declaration to prefill for an extra account.
    await expect(page.getByLabel("Account handle")).toHaveValue("");
    await page.getByLabel("Account handle").fill("kabir.eats.demo");
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page).toHaveURL(/\/passport\?connected=instagram$/);

    const instagram = accounts.getByRole("link", { name: /^Instagram/ });
    await expect(instagram).toHaveCount(2);
    await expect(accounts.getByText("@kabir.ontheroad.demo · primary")).toBeVisible();
    await expect(accounts.getByText("@kabir.eats.demo", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Verification" }).getByText("2 connected accounts")).toBeVisible();

    await accounts.getByRole("link", { name: /kabir\.eats\.demo/ }).click();
    await page.getByRole("button", { name: "Make this my primary Instagram account" }).click();
    await expect(page.getByText("@kabir.eats.demo · primary account")).toBeVisible();
  });

  test("shows every signal with its provenance", async ({ page }) => {
    await signInAsKabir(page);
    await page.goto("/passport/signals");
    for (const group of ["Career", "Audience", "Consistency", "Authenticity"]) {
      await expect(page.getByRole("region", { name: group })).toBeVisible();
    }
    await expect(page.getByText("Verified").first()).toBeVisible();
    await expect(page.getByText(/confidence/).first()).toBeVisible();
    await expect(page.getByText(/monthly snapshots/)).toBeVisible();
  });

  test("cancelling at the provider shares nothing", async ({ page }) => {
    await signInAsKabir(page);
    await page.goto("/passport/connect?platform=youtube");
    await page.getByRole("checkbox", { name: /I agree to connect this account/ }).check();
    await page.getByRole("button", { name: "Continue to YouTube" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/connect_error=cancelled/);
    await expect(page.getByText("Connection cancelled. Nothing was shared.")).toBeVisible();
  });

  test("a stale or foreign state is rejected at the callback", async ({ page }) => {
    await signInAsKabir(page);
    await page.goto("/passport/connect/callback?state=forged-state-value-0000&code=abc");
    await expect(page).toHaveURL(/connect_error=invalid_state/);
  });

  test("disconnecting returns the platform to self-declared", async ({ page }) => {
    await signInAsKabir(page);
    await page.goto("/passport");
    await page
      .getByRole("region", { name: "Social accounts" })
      .getByRole("link", { name: /^Instagram.*kabir\.ontheroad\.demo/ })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Instagram" })).toBeVisible();
    await expect(page.getByText("12 monthly snapshots stored.")).toBeVisible();
    await page.getByText("Disconnect Instagram…").click();
    await page.getByRole("button", { name: "Yes, disconnect Instagram" }).click();
    await expect(page).toHaveURL(/\/passport\?disconnected=1$/);
    await expect(page.getByText("@kabir.ontheroad.demo · self-declared")).toHaveCount(2);
    // The extra account stays connected (and is still the primary one).
    await expect(page.getByText("@kabir.eats.demo · primary")).toBeVisible();
  });

  test("edits the Passport with the same validation as onboarding", async ({ page }) => {
    await signInAsKabir(page);
    await page.goto("/passport");
    await page.getByRole("link", { name: "Edit about you" }).click();
    await expect(page).toHaveURL(/\/passport\/edit\/about$/);
    await page.getByLabel("Display name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
    await page.getByLabel("Display name").fill("Kabir On The Road");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/passport\?updated=about$/);
    await expect(page.getByText("Your details were updated.")).toBeVisible();
    await expect(page.getByRole("figure", { name: /membership card for Kabir On The Road/ })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Recent activity" }).getByText("Updated your Passport"),
    ).toBeVisible();
  });

  test("appearance switches between dark, light and system and is remembered", async ({ page }) => {
    await signInAsKabir(page);
    await page.goto("/account");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "Light" }).check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "Dark" }).check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("member layout on iPhone @mobile", () => {
  test("uses a bottom tab bar and no horizontal scroll", async ({ page, isMobile }) => {
    test.skip(!isMobile, "iPhone layout only");
    await signIn(page, "aarohi.menon@creators.creatorco.test");
    await expect(page).toHaveURL(/\/dashboard$/);
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    for (const name of ["Home", "Passport", "Access", "Account"])
      await expect(tabs.getByRole("link", { name })).toBeVisible();
    await tabs.getByRole("link", { name: "Passport" }).click();
    await expect(page).toHaveURL(/\/passport$/);
    await expect(tabs.getByRole("link", { name: "Passport" })).toHaveAttribute("aria-current", "page");
    for (const path of [
      "/dashboard",
      "/passport",
      "/passport/signals",
      "/access",
      "/account",
      "/passport/edit/profile",
    ]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
  });
});
