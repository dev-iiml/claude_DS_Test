import { expect, test, type Browser, type Page } from "@playwright/test";

import { signIn } from "./helpers";

const MAKER = "ops.admin@staff.creatorco.test";
const CHECKER = "ops.approver@staff.creatorco.test";

async function asUser(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/ops$/);
  return page;
}

test.describe("integration control plane", () => {
  test("ops admins land on /ops; ops and risk consoles are separate", async ({ browser }) => {
    const ops = await asUser(browser, MAKER);
    await expect(ops.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
    await expect(ops.getByRole("link", { name: /Credit bureau/ })).toBeVisible();
    expect((await ops.goto("/admin"))?.status()).toBe(404);

    const riskContext = await browser.newContext();
    const risk = await riskContext.newPage();
    await signIn(risk, "risk.admin@staff.creatorco.test");
    await expect(risk).toHaveURL(/\/admin$/);
    expect((await risk.goto("/ops"))?.status()).toBe(404);
  });

  test("a route change needs a second ops admin", async ({ browser }) => {
    const maker = await asUser(browser, MAKER);
    await maker.goto("/ops/providers/bureau");

    // An unrouted mock config applies at once.
    await maker.locator("summary", { hasText: "Add a config" }).click();
    await maker.getByLabel("Key").fill("bureau_b");
    const addForm = maker.locator("form", { has: maker.getByLabel("Key") });
    await addForm.getByRole("checkbox", { name: "Enabled" }).check();
    await addForm.getByLabel("Reason").fill("Second bureau for failover");
    await addForm.getByRole("button", { name: "Create config" }).click();
    await expect(maker.getByText("Change applied.")).toBeVisible();

    await maker.locator("summary", { hasText: "Change route" }).click();
    const routeForm = maker.locator("form", { has: maker.getByLabel("Fallback") });
    await routeForm.getByLabel("Fallback").selectOption({ label: "bureau_b · mock" });
    await routeForm.getByLabel("Reason").fill("Enable failover");
    await routeForm.getByRole("button", { name: "Request route change" }).click();
    await expect(maker.getByText(/Change requested/)).toBeVisible();

    await maker.goto("/ops/changes");
    await expect(maker.getByRole("button", { name: "Cancel my request" })).toBeVisible();
    await expect(maker.getByRole("button", { name: "Approve and apply" })).toHaveCount(0);

    const checker = await asUser(browser, CHECKER);
    await checker.goto("/ops/changes");
    await checker.getByRole("button", { name: "Approve and apply" }).first().click();
    await expect(checker.getByText("Approved and applied.")).toBeVisible();

    await maker.goto("/ops/providers/bureau");
    const route = maker.getByRole("region", { name: "Route" });
    await expect(route.getByRole("listitem").filter({ hasText: "Fallback" })).toContainText("bureau_b · mock");
  });

  test("the kill switch is instant; lifting it is approved by someone else @mobile", async ({ browser }) => {
    const maker = await asUser(browser, MAKER);
    await maker.goto("/ops/providers/lender");
    const pause = maker.locator("details", { has: maker.locator("summary", { hasText: /^Kill switch/ }) });
    await pause.locator("summary").click();
    await pause.getByLabel("Reason").fill("Rehearsing incident response");
    await pause.getByRole("button", { name: /Pause all partner lender calls now/ }).click();
    await expect(maker.getByText("Kill switch engaged")).toBeVisible();

    const lift = maker.locator("details", { has: maker.locator("summary", { hasText: "Lift the kill switch" }) });
    await lift.locator("summary").click();
    await lift.getByLabel("Reason").fill("Rehearsal finished");
    await lift.getByRole("button", { name: /Request to resume/ }).click();
    await expect(maker.getByText(/Change requested/)).toBeVisible();

    const checker = await asUser(browser, CHECKER);
    await checker.goto("/ops/changes");
    const card = checker.locator("article", { hasText: "Lift kill switch" });
    await card.getByRole("button", { name: "Approve and apply" }).click();
    await expect(checker.getByText("Approved and applied.")).toBeVisible();
    await checker.goto("/ops");
    await expect(checker.getByRole("link", { name: /Partner lender/ })).toContainText("Serving");
  });

  test("jobs can be run from the console", async ({ browser }) => {
    const ops = await asUser(browser, MAKER);
    await ops.goto("/ops/jobs");
    await ops
      .getByRole("listitem")
      .filter({ hasText: "Provider health checks" })
      .first()
      .getByRole("button", { name: "Run now" })
      .click();
    await expect(ops.getByText("Job run.")).toBeVisible();
    await expect(ops.getByRole("listitem").filter({ hasText: "attempt 1/5" }).first()).toContainText("succeeded");
  });
});
