import { expect, test, type Browser, type Page } from "@playwright/test";

import { DEMO_PASSWORD, E2E_PASSWORD, signIn } from "./helpers";

/**
 * Stage 19 — Verified Creator Passport. Kabir (seed) has verified brand work with
 * Wanderlane Luggage (visible) and Peakline Outdoors (PRIVATE), and Chai Theory
 * Cafes still in review. None of those names, nor any amount, may reach a
 * stranger's HTML; Peakline never appears by name at all.
 */
const KABIR = "kabir.sethi@creators.creatorco.test";
const SLUG = `kabir-e2e-${Date.now().toString(36)}`;
const SECRET = ["Wanderlane", "Peakline", "Chai Theory", "Skyroute", "85,000", "1,20,000"];

async function asKabir(page: Page) {
  await signIn(page, KABIR);
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Publishing needs one connected account; connect YouTube through the mock provider if none is connected yet. */
async function ensureConnectedAccount(page: Page) {
  await page.goto("/passport");
  const unverified = page
    .getByRole("region", { name: "Verification" })
    .getByText("Self-declared — connect an account to verify");
  if (await unverified.count()) {
    await page.goto("/passport/connect?platform=youtube");
    const agree = page.getByRole("checkbox", { name: /I agree to connect this account/ });
    if (await agree.count()) await agree.check();
    await page.getByRole("button", { name: /^Continue/ }).click();
    await expect(page).toHaveURL(/\/connect\/mock\?/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page).toHaveURL(/\/passport\?connected=/);
  }
}

async function stranger(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

test.describe("Verified Creator Passport", () => {
  test.describe.configure({ mode: "serial" });

  test("creator publishes; a stranger sees the locked tier with nothing leaked", async ({ page, browser }) => {
    await asKabir(page);
    await ensureConnectedAccount(page);
    await page.goto("/passport");
    await page.getByRole("link", { name: /Get your public link/ }).click();
    await expect(page).toHaveURL(/\/passport\/sharing$/);

    // Publishing needs its own consent.
    await page.getByLabel("Your link").fill(SLUG);
    await page.getByRole("button", { name: "Publish my Passport" }).click();
    await expect(page.getByText("Agree to the consent to continue.").first()).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree to publishing my public Passport/ }).check();
    await page.getByRole("button", { name: "Publish my Passport" }).click();
    await expect(page.getByText("Your Passport is live.")).toBeVisible();

    // Live preview: switching to "An unlocker" shows the brand; the stranger view never does.
    const preview = page.getByRole("region", { name: "Preview" });
    await expect(preview).not.toContainText("Wanderlane");
    await preview.getByRole("radio", { name: "An unlocker" }).check();
    await expect(preview).toContainText("Wanderlane Luggage");
    await expect(preview).not.toContainText("Peakline");

    const s = await stranger(browser);
    const res = await s.page.goto(`/p/${SLUG}`);
    expect(res?.status()).toBe(200);
    // Name, photo and handles are public by default; brand work is not.
    await expect(s.page.getByRole("heading", { level: 1, name: "Kabir On The Road" })).toBeVisible();
    await expect(s.page.getByRole("region", { name: "Brands worked with" })).toBeVisible();
    const html = await s.page.content();
    for (const secret of SECRET) expect(html, secret).not.toContain(secret);
    expect(html).toContain("Verified by CreatorCo");
    // Robots: not indexed unless the creator turns it on.
    await expect(s.page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await s.ctx.close();
  });

  test("an access code unlocks for that passport; revoking locks it again", async ({ page, browser }) => {
    await asKabir(page);
    await page.goto("/passport/sharing");
    await page.getByRole("checkbox", { name: /I agree to letting the people I choose unlock my Passport/ }).check();
    await page.getByRole("region", { name: "Who can unlock" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Who can unlock was saved.")).toBeVisible();

    await page.goto("/passport/sharing/codes");
    await page.getByLabel("Label").fill("E2E agency");
    await page.getByRole("button", { name: "Create code" }).click();
    const code = (await page.getByTestId("new-access-code").textContent())!.trim();
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    const s = await stranger(browser);
    await s.page.goto(`/p/${SLUG}`);
    await s.page.getByLabel("Access code").fill(code);
    await s.page.getByLabel("Your name").fill("Asha");
    await s.page.getByRole("button", { name: /^Unlock/ }).click();
    await expect(s.page.getByText("Unlocked with an access code.")).toBeVisible();
    await expect(s.page.getByRole("region", { name: "Brands worked with" })).toContainText("Wanderlane Luggage");
    const unlocked = await s.page.content();
    expect(unlocked).not.toContain("Peakline");
    expect(unlocked).not.toContain("85,000");
    expect(unlocked).not.toContain("1,20,000");

    // A different passport isn't unlocked by this cookie (the gone page for an unknown link).
    const other = await s.page.goto("/p/someone-else-entirely");
    expect(other?.status()).toBe(410);

    await page.goto("/passport/sharing/log");
    await expect(page.getByText("Asha")).toBeVisible();

    await page.goto("/passport/sharing/codes");
    await page.getByRole("button", { name: "Revoke code E2E agency" }).click();
    await expect(page.getByText("Code revoked.")).toBeVisible();

    await s.page.goto(`/p/${SLUG}`);
    await expect(s.page.getByRole("heading", { level: 2, name: "Unlock the details" })).toBeVisible();
    expect(await s.page.content()).not.toContain("Wanderlane");
    await s.ctx.close();
  });

  test("a brand signs up, two admins verify it, it unlocks, and the creator sees a verified log entry", async ({
    page,
    browser,
  }) => {
    const domain = `lumen${Date.now().toString(36)}.example`;
    const orgName = `Lumen E2E ${Date.now().toString(36)} Private Limited`;

    // Sign up (free mail refused first).
    const b = await stranger(browser);
    await b.page.goto("/brands/signup");
    await b.page.getByLabel("Work email").fill("someone@gmail.com");
    await b.page.getByRole("button", { name: "Send a code" }).click();
    await expect(b.page.getByText("Use your organisation's email address, not a personal one.").first()).toBeVisible();
    await b.page.getByLabel("Work email").fill(`owner@${domain}`);
    await b.page.getByRole("button", { name: "Send a code" }).click();
    await expect(b.page).toHaveURL(/\/brands\/signup\/details\?c=/);
    await b.page.getByLabel("Code from the email").fill("123456");
    await b.page.getByLabel("Password").fill(E2E_PASSWORD);
    await b.page.getByLabel("Organisation's legal name").fill(orgName);
    await b.page.getByLabel("Website").fill(`https://${domain}`);
    await b.page.getByLabel("CIN", { exact: true }).fill(`U74999ZZ2022PTC${String(Date.now()).slice(-6)}`);
    await b.page.getByRole("checkbox", { name: /I accept the brand terms/ }).check();
    await b.page.getByRole("button", { name: "Create account" }).click();
    await expect(b.page).toHaveURL(/\/brands\?welcome=1$/);
    await expect(b.page.getByText("Being checked")).toBeVisible();

    // Admin A checks; admin A can't approve; admin B approves.
    const a = await stranger(browser);
    await signIn(a.page, "partnerships.admin@staff.creatorco.test", DEMO_PASSWORD);
    await expect(a.page).toHaveURL(/\/partnerships/);
    await a.page.goto("/partnerships/brand-orgs?f=to_verify");
    await a.page.getByRole("link", { name: new RegExp(orgName) }).click();
    await a.page.getByRole("region", { name: "Company register" }).getByRole("button", { name: "Check" }).click();
    await expect(a.page.getByText("Company register checked.")).toBeVisible();
    await a.page.getByRole("button", { name: "Mark as checked" }).click();
    await expect(a.page.getByText("You checked this. A different admin approves.")).toBeVisible();
    const orgUrl = a.page.url().split("?")[0]!;
    await a.ctx.close();

    const c = await stranger(browser);
    await signIn(c.page, "partnerships.approver@staff.creatorco.test", DEMO_PASSWORD);
    await expect(c.page).toHaveURL(/\/partnerships/);
    await c.page.goto(orgUrl);
    await c.page.getByRole("button", { name: "Approve — verify organisation" }).click();
    await expect(c.page.getByText("Organisation verified.")).toBeVisible();
    await c.ctx.close();

    // The creator opens unlocking to verified brands.
    await asKabir(page);
    await page.goto("/passport/sharing");
    await page.getByRole("radio", { name: /Code holders and verified brands/ }).check();
    await page.getByRole("region", { name: "Who can unlock" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Who can unlock was saved.")).toBeVisible();

    // The brand unlocks.
    await b.page.goto(`/p/${SLUG}`);
    await b.page.getByRole("button", { name: `Unlock as ${orgName}` }).click();
    await expect(b.page.getByText(`Unlocked for ${orgName} today.`)).toBeVisible();
    await expect(b.page.getByRole("region", { name: "Brands worked with" })).toContainText("Wanderlane Luggage");
    expect(await b.page.content()).not.toContain("Peakline");
    await b.ctx.close();

    await page.goto("/passport/sharing/log");
    const row = page.getByRole("region", { name: "Unlocks" }).getByText(orgName);
    await expect(row).toBeVisible();
    await expect(page.getByText("Verified brand").first()).toBeVisible();
  });

  test("taking the Passport offline answers 410 straight away", async ({ page, browser }) => {
    await asKabir(page);
    await page.goto("/passport/sharing");
    await page.getByRole("button", { name: "Take my Passport offline" }).click();
    await expect(page.getByText("Your Passport is offline.")).toBeVisible();
    const s = await stranger(browser);
    const res = await s.page.goto(`/p/${SLUG}`);
    expect(res?.status()).toBe(410);
    await s.ctx.close();
  });
});
