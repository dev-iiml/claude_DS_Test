# design-system/ — how to use this folder

This folder is the **CreatorCo design system spec** (draft v0.1, captured 2026-10-03 from Stages 00–04).
A browsable copy lives in the "CreatorCo" Design System artifact on claude.ai (Aman's account, private).

## For anyone (human or agent) building UI in this repo

1. Read `design-system/README.md` before any UI or UX change — it holds the voice, colour, type, spacing,
   state and accessibility rules.
2. Token names and values: `design-system/tokens.json`. They mirror `src/app/globals.css`, which is the
   implementation. Use the Tailwind utilities those tokens generate (`bg-paper`, `text-ink-muted`,
   `border-line`, `rounded-md`, `font-serif` …); never hard-code a hex value in a component.
3. Before building a screen, check `design-system/components/<Name>/README.md` for an existing component
   and its do/don'ts. `preview.html` files are static renditions for reference, not app code.
4. `design-system/PROPOSALS.md` lists **proposed** changes. They are not rules until moved into
   `README.md` / `tokens.json` and implemented in `globals.css`. Don't implement a proposal without approval.

## Keeping spec and code in step

- Design change → update `tokens.json` / `README.md` here first, then `globals.css` and the component.
- Code change that alters the look (a new token, variant or component) → reflect it here in the same change.
- If `globals.css` and `tokens.json` disagree, flag it rather than guessing which is right.
