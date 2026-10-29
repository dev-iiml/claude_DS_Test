import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";

/**
 * Stage 16: automated accessibility checks (axe, WCAG 2.1 A/AA) on the main
 * creator and staff screens, in both themes. Fails on serious or critical
 * violations; automated checks complement — not replace — a manual review.
 */
async function audit(page: Page, label: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} (${v.impact}) × ${v.nodes.length} — ${v.nodes[0]?.target.join(" ")}`);
  return blocking;
}

async function auditAll(page: Page, paths: string[], suffix = "") {
  const found: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    found.push(...(await audit(page, `${path}${suffix}`)));
  }
  expect(found, found.join("\n")).toEqual([]);
}

test.describe("accessibility", () => {
  test("public pages", async ({ page }) => {
    await auditAll(page, ["/", "/login", "/signup"]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`creator screens (${theme})`, async ({ page }) => {
      await page.context().addCookies([{ name: "cc_appearance", value: theme, url: "http://localhost:3100" }]);
      await signIn(page, "aarohi.menon@creators.creatorco.test");
      await expect(page).toHaveURL(/\/dashboard$/);
      await auditAll(
        page,
        [
          "/dashboard",
          "/passport",
          "/passport/status",
          "/access",
          "/access/points",
          "/eligibility",
          "/account/consents",
        ],
        ` (${theme})`,
      );
    });
  }

  test("staff screens", async ({ page }) => {
    await signIn(page, "risk.admin@staff.creatorco.test");
    await auditAll(page, ["/admin", "/admin/underwriting", "/admin/models", "/insights", "/insights/models"]);
  });

  test("ops and partnerships screens", async ({ page, browser }) => {
    await signIn(page, "ops.admin@staff.creatorco.test");
    await auditAll(page, ["/ops", "/ops/jobs", "/ops/changes", "/ops/partners", "/ops/providers/social"]);
    const other = await browser.newContext();
    const p = await other.newPage();
    await signIn(p, "partnerships.admin@staff.creatorco.test");
    await auditAll(p, ["/partnerships", "/partnerships/opportunities"]);
    await other.close();
  });
});
