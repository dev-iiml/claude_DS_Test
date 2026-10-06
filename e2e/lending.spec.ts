import { expect, test, type APIRequestContext } from "@playwright/test";

import { DEMO_PASSWORD, signIn } from "./helpers";

/** Kabir is free at this point of the run (api.spec discards his check; design-system.spec only views pages). */
const KABIR = "kabir.sethi@creators.creatorco.test";

async function confirmedCheckViaApi(request: APIRequestContext) {
  const auth = await (
    await request.post("/api/v1/auth/sign-in", { data: { email: KABIR, password: DEMO_PASSWORD, client: "ios" } })
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
      purposes: ["studio_setup"],
      requestedAmount: 150000,
      declaredMonthlyIncome: 90000,
      declaredMonthlyEmi: 0,
      incomeSources: ["brand_deals", "platform_payouts"],
    },
  });
  await request.post(`/api/v1/eligibility/${app.id}/credit-check`, {
    headers: h,
    data: { pan: "KBRPS5518F", confirm: true },
  });
  const bank = await (
    await request.post(`/api/v1/eligibility/${app.id}/bank`, { headers: h, data: { mobile: "9876511115" } })
  ).json();
  const reference = new URL(bank.redirectUrl, "http://localhost").searchParams.get("reference");
  await request.post("/api/v1/eligibility/bank/complete", {
    headers: h,
    data: { params: { reference, status: "approved", accounts: "1115-0,1115-1,1115-2" } },
  });
  await request.put(`/api/v1/eligibility/${app.id}/bank/coverage`, { headers: h, data: { allShared: true } });
  const confirmed = await (await request.post(`/api/v1/eligibility/${app.id}/confirm`, { headers: h })).json();
  expect(confirmed.status).toBe("inputs_ready");
  return { id: app.id as string, headers: h };
}

test.describe("partner lender (Stage 12)", () => {
  test.describe.configure({ mode: "serial" });
  let checkId = "";

  test("creator shares a confirmed check; staff confirm the simulated decision; the creator sees it", async ({
    page,
    request,
  }) => {
    const check = await confirmedCheckViaApi(request);
    checkId = check.id;
    const before = await (await request.get(`/api/v1/eligibility/${check.id}`, { headers: check.headers })).json();
    expect(before.lender).toEqual({ stage: "not_shared" });

    // Creator gives the separate consent from the check.
    await signIn(page, KABIR);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto(`/eligibility/${check.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Check complete" })).toBeVisible();
    await page.getByRole("button", { name: "Share with a partner lender" }).click();
    await expect(page.getByText("Tick the box to give this consent.").first()).toBeVisible();
    await page.getByRole("checkbox", { name: /sending my confirmed checks to a partner lender/ }).check();
    await page.getByRole("button", { name: "Share with a partner lender" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "With a partner lender" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Partner lender" })).toContainText("Awaiting their decision");
    await expect(page.getByRole("region", { name: "Partner lender" })).not.toContainText(/₹|Approved/);

    // Staff review in the risk console.
    await page.context().clearCookies();
    await signIn(page, "risk.admin@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("link", { name: "Proposals" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Credit proposals" })).toBeVisible();
    await page
      .getByRole("region", { name: "Lender decided — awaiting your review" })
      .getByRole("link", { name: new RegExp(check.id.slice(0, 8)) })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Credit proposal" })).toBeVisible();
    await expect(page.getByRole("region", { name: "What the lender receives" })).toContainText("Creator-Enhanced");
    await expect(page.getByRole("region", { name: "What the lender receives" })).toContainText(
      "request, financial_capacity, model_results, bank_coverage, fraud_summary",
    );
    await page.getByRole("button", { name: "Confirm decision" }).click();
    await expect(page.getByRole("region", { name: "CreatorCo review" })).toContainText("Confirmed");

    // Creator sees the reviewed decision, labelled as simulated.
    await page.context().clearCookies();
    await signIn(page, KABIR);
    await expect(page).toHaveURL(/\/dashboard$/);
    const decided = await (await request.get(`/api/v1/eligibility/${check.id}`, { headers: check.headers })).json();
    expect(decided.lender).toMatchObject({ stage: "decided", simulated: true });
    const hasOffer = decided.lender.offer !== null;
    const badge = hasOffer ? "Offer ready" : "Decision ready";
    // Reachable from the dashboard and from Past checks, not only by URL.
    await expect(page.getByText(badge)).toBeVisible();
    await page.getByRole("link", { name: hasOffer ? "View your offer" : "View the decision" }).click();
    await expect(page).toHaveURL(new RegExp(`/eligibility/${check.id}$`));
    await page.goto("/eligibility");
    await page
      .getByRole("region", { name: "Past checks" })
      .getByRole("link", { name: new RegExp(badge) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/eligibility/${check.id}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: hasOffer ? "Your offer" : "Partner-lender decision" }),
    ).toBeVisible();
    const decision = page.getByRole("region", { name: "Partner-lender decision" });
    await expect(decision.getByText("Simulated pilot")).toBeVisible();
    await expect(decision).toContainText(/Approved|Not approved/);
    await expect(page.locator("main")).not.toContainText(/CreatorCo approved|fraud/i);
    if (!hasOffer) return;

    // Stage 13: the offer, its Key Fact Statement, and acceptance with consent.
    const offer = page.getByRole("region", { name: /Offer from Simulated partner lender/ });
    await expect(offer).toContainText("APR");
    await expect(page.getByRole("group", { name: "Key Fact Statement" })).toContainText("Grievance officer");
    await page.getByRole("button", { name: "Accept offer" }).click();
    await expect(page.getByText("Please confirm both to accept.")).toBeVisible();
    await page.getByRole("checkbox", { name: /read the Key Fact Statement/ }).check();
    await page.getByRole("checkbox", { name: /passing my acceptance and contact details/ }).check();
    await page.getByRole("button", { name: "Accept offer" }).click();
    await expect(page.getByText("You accepted this offer", { exact: true })).toBeVisible();
    await expect(page.getByText(/no lender will contact you/)).toBeVisible();
    const after = await (await request.get(`/api/v1/eligibility/${check.id}`, { headers: check.headers })).json();
    expect(after.lender.offer).toMatchObject({ state: "accepted" });
    const consents = await (await request.get("/api/v1/consents/lender_handoff", { headers: check.headers })).json();
    expect(consents.granted).toBe(true);
  });

  test("simulated lender policy changes need a second risk admin", async ({ page }) => {
    expect(checkId).not.toBe("");
    await signIn(page, "risk.admin@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/models");
    await expect(page.getByRole("heading", { level: 1, name: "Models & rules" })).toBeVisible();
    await expect(page.getByRole("region", { name: /Simulated lender policy · v1 \(active\)/ })).toContainText(
      "Traditional",
    );
    await page.getByLabel("Maximum amount (₹)").fill("150000");
    await page.getByLabel("Why the change").fill("Tighter pilot cap");
    await page.getByRole("button", { name: "Propose new version" }).click();
    const proposed = page.getByRole("region", { name: "Proposed · v2" });
    await expect(proposed).toContainText("a different risk admin has to approve");
    await expect(proposed.getByRole("button", { name: /Approve/ })).toHaveCount(0);

    await page.context().clearCookies();
    await signIn(page, "risk.approver@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/models");
    await page.getByRole("region", { name: "Proposed · v2" }).getByRole("button", { name: "Approve v2" }).click();
    await expect(page.getByRole("region", { name: /Simulated lender policy · v2 \(active\)/ })).toContainText(
      "₹1,50,000",
    );
  });
});
