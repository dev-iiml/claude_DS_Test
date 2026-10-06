import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { colors, THEMES } from "../src/design/tokens";
import { signIn } from "./helpers";

/**
 * Design-system screen check (`npm run ds:screens`, also part of the full E2E
 * run). Renders key screens in dark and light, on desktop and mobile, checks
 * the theme tokens actually apply and nothing overflows horizontally, and
 * saves screenshots under `.ds-screens/v<pinned release>/` so the screens
 * before and after an authorized upgrade can be compared side by side.
 */
const lock = JSON.parse(fs.readFileSync("design-system.lock.json", "utf8")) as { release: string };
const OUT = `.ds-screens/v${lock.release}`;

const PUBLIC = [
  ["landing", "/"],
  ["login", "/login"],
] as const;
const CREATOR = [
  ["dashboard", "/dashboard"],
  ["passport", "/passport"],
  ["eligibility", "/eligibility"],
] as const;
const STAFF = [["risk-console", "/admin/underwriting"]] as const;

const hexToRgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

async function capture(page: Page, theme: (typeof THEMES)[number], name: string, project: string) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg, `${name}: body uses the ${theme} paper token`).toBe(hexToRgb(colors[theme].paper));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${name}: no horizontal scroll`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT}/${project}-${theme}-${name}.png`, fullPage: true });
}

for (const theme of THEMES) {
  test(`design system v${lock.release} — key screens in ${theme} @ds @mobile`, async ({ page, context }, info) => {
    const url = new URL(info.project.use.baseURL ?? "http://localhost:3100");
    await context.addCookies([{ name: "cc_appearance", value: theme, domain: url.hostname, path: "/" }]);
    const project = info.project.name;

    for (const [name, path] of PUBLIC) {
      await page.goto(path);
      await capture(page, theme, name, project);
    }

    await signIn(page, "kabir.sethi@creators.creatorco.test");
    await expect(page).toHaveURL(/\/dashboard$/);
    for (const [name, path] of CREATOR) {
      await page.goto(path);
      await capture(page, theme, name, project);
    }

    await context.clearCookies();
    await context.addCookies([{ name: "cc_appearance", value: theme, domain: url.hostname, path: "/" }]);
    await signIn(page, "risk.admin@staff.creatorco.test");
    await expect(page).toHaveURL(/\/admin$/);
    for (const [name, path] of STAFF) {
      await page.goto(path);
      await capture(page, theme, name, project);
    }
  });
}
