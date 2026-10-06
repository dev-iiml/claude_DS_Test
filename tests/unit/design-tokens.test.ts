import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderTokensCss } from "@/design/render-css";
import { renderDesignSystemTokens } from "@/design/render-json";
import { colors, membership, MIN_TOUCH_TARGET, sizes, THEMES } from "@/design/tokens";

type RGB = [number, number, number];

function parse(color: string): { rgb: RGB; alpha: number } {
  if (color.startsWith("#")) {
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as RGB;
    return { rgb, alpha: 1 };
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`Unsupported colour ${color}`);
  const parts = m[1]!.split(",").map((p) => Number(p.trim()));
  return { rgb: [parts[0]!, parts[1]!, parts[2]!], alpha: parts[3] ?? 1 };
}

/** Composites `fg` (possibly translucent, or with an extra opacity) over an opaque `bg`. */
function over(fg: string, bg: string, opacity = 1): string {
  const f = parse(fg);
  const b = parse(bg);
  const a = f.alpha * opacity;
  const mix = f.rgb.map((c, i) => Math.round(c * a + b.rgb[i]! * (1 - a))) as RGB;
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string) {
  const [r, g, b] = parse(hex).rgb.map((c) => c / 255) as RGB;
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(THEMES)("%s theme contrast (WCAG AA)", (theme) => {
  const c = colors[theme];
  const grounds = [c.paper, c.surface, c.elevated];

  it.each(["ink", "inkMuted", "inkSubtle", "gold", "success", "warning", "danger", "info"] as const)(
    "%s text is ≥ 4.5:1 on paper, surface and elevated",
    (fg) => {
      for (const bg of grounds) expect(contrast(c[fg], bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("status colours are legible on their soft backgrounds", () => {
    for (const [fg, bg] of [
      [c.gold, c.goldSoft],
      [c.success, c.successSoft],
      [c.warning, c.warningSoft],
      [c.danger, c.dangerSoft],
      [c.info, c.infoSoft],
    ] as const) {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("primary, gold and inverted (ink) fills carry legible labels", () => {
    expect(contrast(c.primaryForeground, c.primary)).toBeGreaterThanOrEqual(4.5);
    // Button variant="gold" and the checked choice indicator: paper on gold.
    expect(contrast(c.paper, c.gold)).toBeGreaterThanOrEqual(4.5);
    // Selected chips / segments and the "ink" badge: paper on ink.
    expect(contrast(c.paper, c.ink)).toBeGreaterThanOrEqual(4.5);
    // Text selection.
    expect(contrast(c.ink, c.goldSoft)).toBeGreaterThanOrEqual(4.5);
  });

  it("control boundaries and states meet 3:1 (WCAG 1.4.11)", () => {
    // Field borders, switch off-track, unmet checklist ring, upcoming progress step.
    for (const bg of grounds) expect(contrast(c.inputBorder, bg)).toBeGreaterThanOrEqual(3);
    // Focus ring and current progress step.
    for (const bg of grounds) expect(contrast(c.gold, bg)).toBeGreaterThanOrEqual(3);
    // Switch: thumb distinct from both tracks' surroundings; on-track distinct from the card.
    expect(contrast(c.thumb, c.inputBorder)).toBeGreaterThanOrEqual(3);
    for (const bg of [c.surface, c.elevated]) expect(contrast(c.success, bg)).toBeGreaterThanOrEqual(3);
    // Choice indicator ring (unchecked).
    for (const bg of grounds) expect(contrast(c.inkSubtle, bg)).toBeGreaterThanOrEqual(3);
    // Progress meter fill against its track (line-strong at 60% over surface).
    expect(contrast(c.gold, over(c.lineStrong, c.surface, 0.6))).toBeGreaterThanOrEqual(3);
  });

  it("line and lineStrong are decorative only (documented as < 3:1)", () => {
    // Guard: if these ever pass 3:1 the docs can relax the rule; until then they must not mark controls.
    for (const bg of [c.surface, c.elevated]) expect(contrast(c.lineStrong, bg)).toBeLessThan(3);
  });

  it("text on translucent bars stays AA once composited over paper", () => {
    const bar = over(c.bar, c.paper);
    for (const fg of [c.ink, c.inkSubtle, c.gold]) expect(contrast(fg, bar)).toBeGreaterThanOrEqual(4.5);
  });

  it("checked choice rows: ink/50 ring is a visible state (≥ 3:1) on surface and elevated", () => {
    for (const bg of [c.surface, c.elevated]) expect(contrast(over(c.ink, bg, 0.5), bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("membership card material", () => {
  it("text and accent opacities are AA on the card base", () => {
    expect(contrast(membership.ink, membership.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(membership.accent, membership.base)).toBeGreaterThanOrEqual(4.5);
    for (const o of [0.5, 0.6, 0.7, 0.8]) {
      expect(contrast(over(membership.ink, membership.base, o), membership.base)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("touch targets", () => {
  it("primary interactive sizes meet MIN_TOUCH_TARGET", () => {
    for (const k of ["control", "controlLg", "row", "choiceRow", "tabBar", "topBar"] as const) {
      expect(sizes[k]).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });
});

const decls = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .match(/--[a-z0-9-]+: [^;]+;/g)
    ?.sort() ?? [];

describe("generated files", () => {
  it("tokens.css is in sync with tokens.ts (run `npm run tokens`)", () => {
    // Prettier may reflow the file; compare declarations only.
    expect(decls(readFileSync("src/app/tokens.css", "utf8"))).toEqual(decls(renderTokensCss()));
  });

  it("design-system/tokens.json is in sync with tokens.ts (run `npm run tokens`)", () => {
    const onDisk = JSON.parse(readFileSync("design-system/tokens.json", "utf8")) as unknown;
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(renderDesignSystemTokens())));
  });
});

describe("token utilities used in components exist", () => {
  it("every colour utility built on a token name maps to a --color-* in globals.css", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const globals = readFileSync("src/app/globals.css", "utf8");
    const defined = new Set([...globals.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
    const STEMS =
      /^(paper|surface|elevated|ink|line|input|primary|gold|brand|success|warning|danger|info|bar|thumb|membership)/;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk("src");
    const missing = new Set<string>();
    const re =
      /(?:^|[\s"'`:])(?:bg|text|border|ring|fill|stroke|outline|divide|accent|decoration|caret|placeholder)-([a-z][a-z0-9-]*?)(?:\/\d+)?(?=[\s"'`]|$)/g;
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(re)) {
        const name = m[1]!;
        if (STEMS.test(name) && !defined.has(name)) missing.add(`${name} (${f})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
