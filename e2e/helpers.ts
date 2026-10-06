import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CreatorCo-demo-2026";

export function uniqueEmail(label: string) {
  return `${label}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@e2e.creatorco.test`;
}

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export const E2E_PASSWORD = "Strong-e2e-pass1";

/** A unique fictional mobile number whose last digit drives the mock identity/GST providers. */
export function uniqueMobile(lastDigit: number) {
  return `9${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}${lastDigit}`;
}

export async function signUp(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding\/welcome$/);
}
