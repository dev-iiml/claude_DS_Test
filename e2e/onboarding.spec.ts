import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { E2E_PASSWORD, signIn, signUp, uniqueEmail, uniqueMobile } from "./helpers";

test.describe("Cohort A0 creator journey", () => {
  test("sign up → six-step onboarding → dashboard @mobile", async ({ page }) => {
    const email = uniqueEmail("journey");
    await signUp(page, email);

    // Step 1 — Welcome
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to CreatorCo" })).toBeVisible();
    await expect(page.getByText("Step 1 of 6")).toBeVisible();
    await page.getByRole("link", { name: "Begin" }).click();

    // Step 2 — About you (server-side validation first)
    await expect(page).toHaveURL(/\/onboarding\/about$/);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator("main").getByRole("alert").first()).toContainText("Please check the highlighted fields");
    await expect(page.getByText("Choose at least one language.")).toBeVisible();

    // Optional identity prefill: verify mobile by OTP → consent → fetch name.
    const panel = page.getByRole("region", { name: "Prefill your legal name" });
    await panel.getByLabel("Mobile number").fill(uniqueMobile(4));
    await panel.getByRole("button", { name: "Send code" }).click();
    await expect(panel.getByText("Demo mode")).toBeVisible();
    await panel.getByLabel(/Enter the 6-digit code/).fill("000000");
    await panel.getByRole("button", { name: "Verify" }).click();
    await expect(panel.getByText(/That code isn't right/)).toBeVisible();
    await panel.getByLabel(/Enter the 6-digit code/).fill("123456");
    await panel.getByRole("button", { name: "Verify" }).click();
    await expect(panel.getByText(/Mobile verified/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Fetch my legal name" })).toBeDisabled();
    await panel.getByRole("checkbox", { name: /I agree to CreatorCo fetching/ }).check();
    await panel.getByRole("button", { name: "Fetch my legal name" }).click();
    await expect(panel.getByText(/PAN XXXXX\d{4}[A-Z]/)).toBeVisible();
    await expect(page.getByLabel("Legal name", { exact: true })).not.toHaveValue("");
    await expect(page.getByText("Matches verified name")).toBeVisible();
    const verifiedName = await page.getByLabel("Legal name", { exact: true }).inputValue();

    await page.getByLabel("Display name").fill("Riya Frames");
    await expect(page.getByLabel("City")).toBeDisabled();
    await page.getByLabel("State or union territory").selectOption("Maharashtra");
    await page.getByLabel("City").selectOption("Pune");
    await page.getByRole("checkbox", { name: "English", exact: true }).check();
    await page.getByRole("checkbox", { name: "Marathi", exact: true }).check();
    await page.getByRole("button", { name: "+ Other" }).click();
    await page.getByLabel("Other language").fill("Konkani");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("button", { name: "Remove Konkani" })).toBeVisible();
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 3 — Creator profile: up to three categories, one main
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    await page.getByLabel("Primary creator handle").fill("@riya.frames.e2e");
    const cats = page.getByRole("group", { name: "Categories" });
    await cats.getByRole("checkbox", { name: "Photography & film", exact: true }).check();
    await cats.getByRole("checkbox", { name: "Travel", exact: true }).check();
    await cats.getByRole("checkbox", { name: "Fashion", exact: true }).check();
    await expect(cats.getByRole("checkbox", { name: "Food" })).toBeDisabled();
    await page.getByRole("radio", { name: "Travel" }).check();
    await page.getByLabel("Creating professionally since").fill("2019-04");
    await page.getByRole("checkbox", { name: "Instagram" }).check();
    await expect(page.getByLabel("Instagram handle")).toBeVisible();
    await page.getByRole("checkbox", { name: "YouTube" }).check();
    await page.getByLabel("YouTube handle").fill("RiyaFramesTV");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 4 — Business status: GST lookup by PAN prefills GSTIN and legal form
    await expect(page).toHaveURL(/\/onboarding\/business$/);
    await expect(page.getByLabel("GSTIN")).toHaveCount(0);
    await page.getByRole("button", { name: "Find my GST registrations" }).click();
    const found = page.getByRole("list", { name: "GST registrations found" });
    await expect(found.getByText("Active")).toBeVisible();
    await expect(found.getByText("Proprietorship")).toBeVisible();
    await expect(page.getByLabel("Registered for GST", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Sole proprietor")).toBeChecked();
    await expect(page.getByLabel("GSTIN")).toHaveValue(/^27[A-Z]{5}\d{4}[A-Z]1Z[0-9A-Z]$/);
    const lookedUpGstin = await page.getByLabel("GSTIN").inputValue();
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 5 — Interests
    await expect(page).toHaveURL(/\/onboarding\/interests$/);
    await page.getByRole("switch", { name: /PR packages/ }).check();
    await page
      .getByRole("group", { name: "PR categories" })
      .getByRole("checkbox", { name: "Photography & film" })
      .check();
    await page
      .getByRole("group", { name: /Brand categories/ })
      .getByRole("checkbox", { name: "Travel" })
      .check();
    await page.getByRole("switch", { name: /travel and event/i }).check();
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 6 — Versioned consent
    await expect(page).toHaveURL(/\/onboarding\/consent$/);
    await expect(page.getByText("Version 1")).toBeVisible();
    await page.getByRole("button", { name: "Complete profile" }).click();
    await expect(page.getByText("Tick the box to give your consent.")).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await page.getByRole("button", { name: "Complete profile" }).click();

    // Home
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: "Riya Frames" })).toBeVisible();
    const card = page.getByRole("figure", { name: /membership card for Riya Frames/ });
    await expect(card.getByText("@riya.frames.e2e")).toBeVisible();
    await expect(card.getByText(/^CC [0-9A-F]{4} [0-9A-F]{4}$/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Connect a social account/ })).toBeVisible();
    await expect(page.getByText("Creator Status: Member")).toBeAttached();
    await expect(page.getByRole("link", { name: "Check financial eligibility" })).toBeVisible();
    // Welcome (500) + verified mobile (100) Creator Points.
    await expect(page.getByText(/600 points available · Preview with sample brands/)).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Passport completion" })).toHaveAttribute("aria-valuenow", "80");
    await expect(
      page
        .getByRole("navigation", { name: "Tabs" })
        .or(page.getByRole("navigation", { name: "Primary" }))
        .first(),
    ).toBeVisible();
    // Responsive: no horizontal scrolling on any viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // No fake credit limit anywhere.
    await expect(page.locator("main")).not.toContainText("₹");

    // Persisted state, checked directly in the database.
    const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
    try {
      const [row] = await sql`
        select p.display_name, p.legal_name, p.legal_name_source, p.creator_category, p.city, p.languages_other,
          p.gst_status, p.gstin, p.legal_form, p.profile_status, d.key, d.version, r.status as consent_status
        from users u
        join creator_profiles p on p.user_id = u.id
        join consent_receipts r on r.user_id = u.id
        join consent_definitions d on d.id = r.consent_definition_id
        where u.email = ${email} and d.key = 'creator_profile'`;
      expect(row).toMatchObject({
        display_name: "Riya Frames",
        legal_name: verifiedName,
        legal_name_source: "verified_lookup",
        creator_category: "travel",
        city: "Pune",
        languages_other: ["Konkani"],
        gst_status: "registered",
        gstin: lookedUpGstin,
        legal_form: "sole_proprietorship",
        profile_status: "completed",
        key: "creator_profile",
        version: 1,
        consent_status: "granted",
      });
    } finally {
      await sql.end();
    }

    // Persistence: sign out (Account tab) and back in lands on Home; onboarding is closed.
    await page.goto("/account");
    await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, email, E2E_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/onboarding/about");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("onboarding resumes at the next incomplete step", async ({ page }) => {
    // Seeded draft creator has completed "about" and "profile".
    await signIn(page, "naina.kapoor@creators.creatorco.test");
    await expect(page).toHaveURL(/\/onboarding\/business$/);
    await page.goto("/onboarding/consent");
    await expect(page).toHaveURL(/\/onboarding\/business$/);
    // Earlier steps keep saved values.
    await page.goto("/onboarding/about");
    await expect(page.getByLabel("Display name")).toHaveValue("Naina Style Notes");
  });

  test("a typed GSTIN is validated as you type and checked against the registry", async ({ page }) => {
    await signIn(page, "naina.kapoor@creators.creatorco.test");
    await expect(page).toHaveURL(/\/onboarding\/business$/);
    await expect(page.getByText(/Verify your mobile and fetch your details/)).toBeVisible();
    await page.getByLabel("Individual creator").check();
    await page.getByLabel("Registered for GST", { exact: true }).check();
    const gstin = page.getByLabel("GSTIN");
    const feedback = page.locator("#gstin-feedback");

    await gstin.fill("2A");
    await expect(feedback).toContainText("Character 2 should be a digit");
    await gstin.fill("27AAPFU");
    await expect(feedback).toContainText("8 more characters");
    await gstin.fill("27AAPFU0939F1ZA");
    await expect(feedback).toContainText("check digit");

    await gstin.fill("27AAPFU0939F9ZN"); // valid format, mock registry reports it cancelled
    await expect(page.getByRole("status", { name: "GST registry result" })).toContainText("Cancelled");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByText(/This GSTIN is cancelled/).first()).toBeVisible();

    await gstin.fill("27aapfu0939f1zv");
    await expect(page.getByRole("status", { name: "GST registry result" })).toContainText("Active");
    await expect(page.getByRole("status", { name: "GST registry result" })).toContainText("Proprietorship");
  });

  test("incorporated businesses are shown as not supported", async ({ page }) => {
    await signIn(page, "naina.kapoor@creators.creatorco.test");
    await page.getByText("Operating through a firm or company?").click();
    await expect(page.getByLabel("Private limited company")).toBeDisabled();
    await expect(page.getByText("Not supported in current pilot").first()).toBeVisible();
  });
});
