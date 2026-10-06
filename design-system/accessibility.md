# Accessibility, validation and maintenance

## What is checked automatically

`tests/unit/design-tokens.test.ts` (runs in `npm test`) checks, in **both themes**:

- Text tokens (`ink`, `ink-muted`, `ink-subtle`, `gold`, `success`, `warning`, `danger`, `info`) ≥ 4.5:1 on `paper`, `surface` and `elevated`; each status colour ≥ 4.5:1 on its `-soft` ground.
- Filled controls: `primary-foreground` on `primary`, `paper` on `gold` (gold button, checked indicator), `paper` on `ink` (selected chip/segment, ink badge), `ink` on `gold-soft` (selection).
- **Non-text contrast (WCAG 1.4.11):** `input-border` ≥ 3:1 on every ground; focus ring (`gold`) ≥ 3:1; switch thumb vs off-track and on-track vs card ≥ 3:1; unchecked indicator ring ≥ 3:1; progress fill vs track ≥ 3:1; checked-row ring (`ink` at 50%) ≥ 3:1.
- **Guard:** `line-strong` stays < 3:1, so it may never be used for control boundaries or states.
- **Opacity variants and translucency:** text on the composited `bar`; membership-card text at 50/60/70/80% opacity on `membership-base`.
- **Touch targets:** primary interactive sizes (`control`, `control-lg`, `row`, `choice-row`, `tab-bar`, `top-bar`) ≥ `MIN_TOUCH_TARGET`.
- **Token utilities exist:** every colour utility in `src/**/*.tsx` built on a token name (`bg-input-border`, `text-gold`, …) must map to a `--color-*` in `globals.css` — Tailwind silently drops unknown classes, so this catches invisible controls.
- **Generated files in sync:** `src/app/tokens.css` and `design-system/tokens.json` must equal what `tokens.ts` renders.

E2E (`npm run test:e2e`) covers the journeys, role-based form controls, appearance switching and "no horizontal scroll on iPhone".

> **These checks are not an accessibility audit.** They prove token pairs and a few component states. Screen-reader flows (VoiceOver, TalkBack), keyboard-only navigation and focus order, Dynamic Type / 200% text, browser zoom and reflow at 320px, reduced-transparency, and real-content contrast inside images still need a manual review before launch.

## Non-text contrast — rule

`line` (~1.2–1.3:1) and `line-strong` (~1.5–1.8:1 on `surface`, both themes) are decorative. **Control boundaries and states use `input-border`** (≥ 3:1): text-field borders, switch off-track, unmet checklist rings, upcoming progress steps. Decorative rings (`ring-line` on cards, chips and choice rows) are allowed only where a label or an indicator that passes 3:1 identifies the control.

## Touch-target audit (`MIN_TOUCH_TARGET` = 44px)

| Control                                       | Visual       | Hit area                        | Verdict                                       |
| --------------------------------------------- | ------------ | ------------------------------- | --------------------------------------------- |
| Button md / lg, Input, NativeSelect           | 50 / 54      | same                            | Pass                                          |
| Button icon, BackLink, onboarding Back        | 44           | same                            | Pass                                          |
| RadioRow, CheckboxRow, SwitchRow              | ≥ 52         | native input stretched over row | Pass                                          |
| ListRow (link)                                | ≥ 48         | whole row                       | Pass                                          |
| TabBar item                                   | 52           | whole cell                      | Pass                                          |
| Button sm (Connect, Sign out, header Sign in) | 36           | 36                              | **Fail** — P-11                               |
| CheckboxChip                                  | 40           | 40                              | **Fail** — P-11                               |
| SegmentedControl segment                      | 34           | 34                              | **Fail** on touch — P-11                      |
| Inline text actions (See all, Edit, Refresh)  | ~20 line box | ~20                             | **Fail** — P-11                               |
| Language chip "Remove" ✕ (about step)         | 24           | 24                              | **Fail** — P-11                               |
| Sidebar row (desktop, pointer)                | 36           | 36                              | Acceptable for pointer (macOS); not for touch |

## Maintenance workflow

See `USAGE.md`. In short: edit `src/design/tokens.ts` → `npm run tokens` → review `tokens.css` and `tokens.json` diffs → `npm run check` → `npm run build && npm run test:e2e`.
