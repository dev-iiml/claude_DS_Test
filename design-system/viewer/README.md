# Preview viewer (dev-only)

Builds the artifact previews from the **real components**, so a card can never drift from the code.

```sh
node design-system/viewer/build.mjs
```

- `src/specimens.tsx` — one specimen per catalogue card, composed from `@/components/ui` and `@/components/creatorco` with demo-seed data. Specimens named `Proposed*` and the proposed `Screen*` compositions are labelled "Proposed — not adopted".
- `src/shims/` — stand-ins for `next/link` and `next/navigation` (the bundle runs outside Next).
- Output: `../components/bundle.js` (IIFE, global `CreatorCo`, React bundled in; `CreatorCo.mount("Button")`) and `../components/bundle.css` (Tailwind compile of `src/app/globals.css`).

## Single-file viewer

```sh
node design-system/viewer/build.mjs       # refresh the bundle first
node design-system/viewer/build-html.mjs  # writes design-system/design-system.html
```

`design-system.html` is one self-contained file (≈8 MB: bundle, fonts and screenshots inlined) that opens offline in any browser: brand book, foundations from `tokens.json`, every component live in its own frame (true breakpoints, Dark/Light/System switch), proposals, screens and the guides.

Rebuild after changing tokens or components, then republish the design-system artifact. Not part of the app build; excluded from lint and typecheck. Turning this into `npm run design:preview` is proposal P-13.
