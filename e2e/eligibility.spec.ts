import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";

/** Seeded completed creator (see src/db/seed/demo.ts). */
const AAROHI = "aarohi.menon@creators.creatorco.test";

async function signInAsAarohi(page: Page) {
  await signIn(page, AAROHI);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("financial eligibility (Stages 09/09b)", () => {
  test.describe.configure({ mode: "serial" });

  test("consent → details → credit check → bank accounts across numbers → review → check complete", async ({
    page,
  }) => {
    await signInAsAarohi(page);
    await page.getByRole("link", { name: "Check financial eligibility" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Financial eligibility" })).toBeVisible();
    await page.getByRole("link", { name: "Check financial eligibility" }).click();

    // Consent
    await expect(page.getByRole("heading", { level: 1, name: "Before we start" })).toBeVisible();
    await expect(page.getByText("Financial eligibility check")).toBeVisible();
    await page.getByRole("button", { name: "Start my check" }).click();
    await expect(page.getByText("Tick the box to give this consent.").first()).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree to CreatorCo checking my financial eligibility/ }).check();
    await page.getByRole("button", { name: "Start my check" }).click();

    // Details: up to three purposes, a note for "Something else"
    await expect(page).toHaveURL(/\/eligibility\/[0-9a-f-]+\/details$/);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
    await page.getByRole("checkbox", { name: "Camera and tech gear" }).check();
    await page.getByRole("checkbox", { name: "Studio or workspace" }).check();
    await page.getByRole("checkbox", { name: "Something else" }).check();
    await expect(page.getByRole("checkbox", { name: "Producing content" })).toBeDisabled();
    await page.getByLabel("Tell us in a few words").fill("A podcast booth");
    await page.getByLabel("Roughly how much?").fill("1,50,000");
    await page.getByLabel("Average monthly income").fill("85000");
    await page.getByRole("checkbox", { name: "Brand deals" }).check();
    await page.getByRole("checkbox", { name: "Platform payouts" }).check();
    await page.getByLabel("Existing monthly EMIs").fill("0");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Credit check — and back to details, which keeps what was entered
    await expect(page).toHaveURL(/\/credit-check$/);
    await page.getByRole("link", { name: "Your details" }).click();
    await expect(page.getByLabel("Tell us in a few words")).toHaveValue("A podcast booth");
    await page.getByLabel("Roughly how much?").fill("1,60,000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/credit-check$/);
    await page.getByLabel("Your PAN").fill("ABCCE1238F");
    await page.getByRole("checkbox", { name: /This is my PAN/ }).check();
    await page.getByRole("button", { name: "Run credit check" }).click();
    await expect(page.getByText(/personal PAN/).first()).toBeVisible();
    await expect(page.getByLabel("Your PAN")).toHaveValue("");
    await page.getByLabel("Your PAN").fill("abcpe1238f");
    await page.getByRole("checkbox", { name: /This is my PAN/ }).check();
    await page.getByRole("button", { name: "Run credit check" }).click();

    // Bank accounts — number 1 has no accounts at the (mock) Account Aggregator
    await expect(page).toHaveURL(/\/bank$/);
    await expect(page.getByText(/Test mode — simulated Account Aggregator/)).toBeVisible();
    await page.getByLabel("Mobile number linked to your bank accounts").fill("98765 00010");
    await page.getByRole("button", { name: "Share via Account Aggregator" }).click();
    await expect(page).toHaveURL(/\/connect\/aa-mock\?/);
    await expect(page.getByText("No accounts found for this number.")).toBeVisible();
    await page.getByRole("button", { name: "Return to CreatorCo" }).click();
    await expect(page).toHaveURL(/\/bank$/);
    await expect(page.getByRole("region", { name: "Mobile ending 0010" })).toContainText("No accounts found");
    await expect(page.getByRole("region", { name: "No bank data received yet" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("9876500010");

    // Number 2 has two accounts; a third number is added inside the AA journey
    await page.getByLabel("Search another mobile number").fill("9876500019");
    await page.getByRole("button", { name: "Search this number" }).click();
    await expect(page.getByText("Accounts linked to ••••••0019 (verified)")).toBeVisible();
    await page.getByText("Add another mobile number").click();
    await page.getByLabel("Mobile number").fill("9876500015");
    await page.getByLabel(/OTP sent to that number/).fill("123456");
    await page.getByRole("button", { name: "Verify and find accounts" }).click();
    await expect(page.getByText("Accounts linked to ••••••0015 (verified)")).toBeVisible();
    await page.getByRole("button", { name: "Approve sharing" }).click();

    // One account timed out: try again
    await expect(page).toHaveURL(/\/bank$/);
    await expect(page.getByRole("region", { name: "Mobile ending 0015" })).toContainText("Shared");
    const second = page.getByRole("region", { name: "Mobile ending 0019" });
    await expect(second).toContainText("Your bank didn't respond");
    await second.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("button", { name: "Approve sharing" }).click();
    await expect(page.getByRole("region", { name: "Mobile ending 0019" })).not.toContainText("didn't respond");

    // Coverage question
    await page.getByRole("radio", { name: "No, some are missing" }).check();
    await page.getByRole("radio", { name: "My bank isn't on the Account Aggregator network" }).check();
    await page.getByRole("button", { name: "Continue to review" }).click();

    // Review — edit details and come back
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole("heading", { level: 1, name: "Review and confirm" })).toBeVisible();
    const yours = page.getByRole("region", { name: "Your details" });
    await expect(yours).toContainText("Camera and tech gear, Studio or workspace, Something else");
    await expect(yours).toContainText("₹1,60,000");
    await expect(page.getByRole("region", { name: "Bank accounts" })).toContainText("5 from 2 numbers");
    await yours.getByRole("link", { name: "Edit your details" }).click();
    await page.getByLabel("Existing monthly EMIs").fill("2,000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/review$/);
    await page.getByRole("button", { name: "Confirm and prepare recommendation" }).click();

    // Check complete
    await expect(page).toHaveURL(/\/eligibility\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Check complete" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Credit history" }).getByText("Strong")).toBeVisible();
    const cash = page.getByRole("region", { name: "Bank cashflow" });
    await expect(cash.getByText("Average creator income each month")).toBeVisible();
    await expect(cash.getByText("Some of your accounts")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "What happens next" }).getByText("Prepared", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText("ABCPE1238F");
    await expect(page.locator("main")).not.toContainText(/approved|you are eligible|limit of|Close this check/i);

    // Home shows the check.
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Review and share" })).toBeVisible();
  });

  test("discarding a check is quiet and erases its inputs", async ({ page }) => {
    await signInAsAarohi(page);
    await page.goto("/eligibility");
    await page.getByRole("region", { name: "Your check" }).getByRole("link").click();
    await page.getByText(/need this check any more\?/).click();
    await page.getByRole("button", { name: "Discard this check" }).click();
    await expect(page).toHaveURL(/\/eligibility\?discarded=1$/);
    await expect(page.getByText("Check discarded. Its financial inputs have been erased.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Past checks" })).toContainText("Closed");
  });

  test("the consent appears in the consent centre", async ({ page }) => {
    await signInAsAarohi(page);
    await page.goto("/account/consents");
    await expect(
      page.getByRole("region", { name: "Optional" }).getByRole("link", { name: /Financial eligibility/ }),
    ).toContainText("On");
  });
});
