import { expect, test } from "@playwright/test";

import { E2E_PASSWORD, signIn, signUp, uniqueEmail } from "./helpers";

test.describe("authentication and role-based access", () => {
  test("protected routes require sign-in", async ({ page }) => {
    for (const path of ["/dashboard", "/onboarding/about", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%2F/g, "(%2F|/)")}`));
    }
  });

  test("wrong password shows a generic error", async ({ page }) => {
    await signIn(page, "aarohi.menon@creators.creatorco.test", "definitely-not-it");
    await expect(page.locator("main").getByRole("alert")).toContainText("don't match our records");
  });

  test("password requirements are checked live as you type", async ({ page }) => {
    await page.goto("/signup");
    const rules = page.locator("#password-rules");
    await page.getByLabel("Password", { exact: true }).fill("abc");
    await expect(rules.locator("li", { hasText: "A lower-case letter" })).toHaveClass(/text-success/);
    await expect(rules.locator("li", { hasText: "At least 8 characters" })).not.toHaveClass(/text-success/);
    await page.getByLabel("Password", { exact: true }).fill("Abcdefg1!");
    for (const label of [
      "At least 8 characters",
      "A lower-case letter",
      "An upper-case letter",
      "A number",
      "A special character (e.g. ! @ # -)",
    ]) {
      await expect(rules.locator("li", { hasText: label })).toHaveClass(/text-success/);
    }
    await page.getByLabel("Confirm password").fill("Abcdefg1?");
    await expect(page.locator("#confirm-rule li")).not.toHaveClass(/text-success/);
    await page.getByLabel("Confirm password").fill("Abcdefg1!");
    await expect(page.locator("#confirm-rule li")).toHaveClass(/text-success/);

    // The server enforces the same rules.
    await page.getByLabel("Email").fill(uniqueEmail("weak"));
    await page.getByLabel("Password", { exact: true }).fill("weakpassword");
    await page.getByLabel("Confirm password").fill("weakpassword");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/Password needs:/)).toBeVisible();
  });

  test("duplicate sign-up is refused", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("aarohi.menon@creators.creatorco.test");
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel("Confirm password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("already exists");
  });

  test("a creator cannot access the admin console", async ({ page }) => {
    await signIn(page, "aarohi.menon@creators.creatorco.test");
    await expect(page).toHaveURL(/\/dashboard$/);
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This page isn’t available")).toBeVisible();
  });

  test("a new creator is sent to onboarding, not the dashboard", async ({ page }) => {
    await signUp(page, uniqueEmail("fresh"));
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding\//);
  });

  test("risk_admin reaches the admin placeholder and is kept out of creator areas", async ({ page }) => {
    await signIn(page, "risk.admin@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Risk console" })).toBeVisible();
    await expect(page.getByText("Creator accounts")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/onboarding/about");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("signed-in users are bounced from auth pages to their home", async ({ page }) => {
    await signIn(page, "dev.malhotra@creators.creatorco.test");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("post-login redirect ignores off-site next parameters", async ({ page }) => {
    await page.goto("/login?next=//evil.example/steal");
    await page.getByLabel("Email").fill("ishita.rao@creators.creatorco.test");
    await page.getByLabel("Password").fill(process.env.SEED_DEMO_PASSWORD ?? "CreatorCo-demo-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/localhost:\d+\/dashboard$/);
  });
});
