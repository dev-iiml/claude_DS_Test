# design-system/ — how to use this folder

This folder is the **CreatorCo design system v1** (3 Oct 2026) — the *target* look and rules, built from the product brief.
A browsable copy with live previews in both themes lives in the "CreatorCo" Design System artifact on claude.ai (Aman's account, private).

> **The app code does not match v1 yet.** `src/app/globals.css` still implements v0.1 (paper/ink/bronze, Newsreader + Inter).
> The v0.1 snapshot of the current code is kept in `archive/v0.1-from-code/`. Moving the app to v1 is a separate, approved piece of work (see PROPOSALS.md, P0).

## For anyone (human or agent) building UI in this repo

1. Read `README.md`, then `status-and-finance.md` and `voice-and-copy.md`, before any UI, UX or copy change.
2. Token names and values: `tokens.json` (light "Chalk" + dark "Onyx", tier materials, charts). The Tailwind v4 / shadcn theme generated from it is `tailwind/creatorco.css`.
3. Before building a screen, check `components/<Name>/README.md` for the component and its do/don'ts, and the `components/Screen0x…` cards for the reference layouts. `preview.html` files are static specimens (they need the artifact's generated tokens.css to render; view them in the artifact), not app code. Props are in `components/index.d.ts`.
4. `implementation.md` maps every spec component to shadcn/ui and gives the ₹ formatting helpers.
5. Icons: `assets/Icons/` (Lucide, 1.5px stroke).
6. `PROPOSALS.md` lists open items. Nothing there is a rule until it moves into the files above.

## Hard rules (summary)

- Creator Status and financial eligibility never share a surface, colour or visual language.
- Rani (`accent`) at most once per view; never on eligibility, charts, errors or the risk console.
- Never: "approved", "guaranteed", "instant loan", "you deserve ₹X", follower counts as a credit factor, "bank" in the CreatorCo brand.
- Wordmark "CreatorCo" is a placeholder — always go through the Wordmark component.

## Keeping spec and code in step

- Design change → update `tokens.json` / the `.md` files here first (regenerate `tailwind/creatorco.css`), then the code.
- Code change that alters the look → reflect it here in the same change.
- If code and spec disagree, flag it rather than guessing which is right.
