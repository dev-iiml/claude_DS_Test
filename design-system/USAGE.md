# Using this design system

This folder is the **CreatorCo design system v2** — it describes the product **as built**. The browsable copy with live previews (light/dark switch) is the "CreatorCo" Design System artifact on claude.ai (Aman's account, private).

## Versions

The app uses **v2.0.0** (`RELEASES.md`). Changes go through experiments → approval → a composed release → explicit adoption. See `versioning/README.md`. Don't edit release snapshots or experiment patches by hand.

## Source of truth

1. `src/design/tokens.ts` — colours per theme, membership material, shadows, radius, spacing, type, sizes, motion, `MIN_TOUCH_TARGET`. Pure module: no Node/DOM/Next imports, so native apps can import it.
2. The live components in `src/components/ui` (shadcn/ui primitives restyled with tokens) and `src/components/creatorco` (product components).
3. This folder documents them. If the docs and the code disagree, **fix the docs** and log it in `CHANGELOG.md`.

## Token pipeline

```
src/design/tokens.ts
   │  npm run tokens
   ├─▶ src/design/scripts/generate-css.ts  ─▶ src/app/tokens.css        (CSS variables; GENERATED)
   └─▶ src/design/scripts/generate-json.ts ─▶ design-system/tokens.json (spec; GENERATED)
                                                │
src/app/globals.css  @theme inline  ◀───────────┘ maps the variables to Tailwind utilities
```

- **Never edit `src/app/tokens.css` or `design-system/tokens.json` by hand.** `npm test` fails if either is out of sync with `tokens.ts`.
- Renderers are pure functions: `src/design/render-css.ts` and `src/design/render-json.ts`.
- `globals.css` maps tokens to Tailwind: colours (`bg-surface`, `text-ink-muted`, `ring-line`, `bg-input-border`, `text-membership-ink/60`), radius (`rounded-sm|md|control|lg|card|xl`), type (`text-large-title` … `text-caption-2`), sizes (`h-control`, `h-control-lg`, `min-h-row`, `min-h-choice-row`, `size-touch`, `w-switch-w`, `h-switch-h`, `w-sidebar`, `max-w-membership-card` …), shadows (`shadow-membership-card`, `shadow-thumb`, `shadow-overlay`), motion (`duration-(--motion-base)`, `ease-spring`, the `press` utility) and platform utilities (`pt-safe`, `pb-safe`, `pb-tabbar`, `sticky-footer`, `bar-blur`).
- New token utility names must also be added to `src/lib/cn.ts` (tailwind-merge config) so `cn()` merges them correctly — otherwise `text-body` is treated as a colour and dropped next to `text-ink`.

## Appearance

`<html data-theme="dark|light|system">`. Dark is the default (`DEFAULT_APPEARANCE`). Light applies explicitly; System follows `prefers-color-scheme`. Write theme-specific styles with the `light:` variant (dark is the base). The setting is a per-device cookie (`cc_appearance`).

## Building UI

- Compose screens from `@/components/creatorco` and `@/components/ui`. Add new primitives with `npx shadcn add`, then restyle them with tokens.
- **Never hard-code hex** (or `white`/`black`) in components. If a value is missing, add a token.
- Prefer token utilities over arbitrary values. The intentional exceptions are listed in `CHANGELOG.md` → "Left as exceptions".
- Status visuals and finance visuals stay separate (`trust-and-copy.md`).
- Before handing off: `npm run check`, then `npm run build && npm run test:e2e`.

## Folder map

| Path                  | What                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`           | Direction, foundations, component list                                                                                                                |
| `patterns.md`         | Responsive application patterns                                                                                                                       |
| `trust-and-copy.md`   | Status vs finance, verification, consent, copy guardrails                                                                                             |
| `accessibility.md`    | Automated checks, non-text contrast, touch-target audit                                                                                               |
| `PROPOSALS.md`        | Proposed rules and components (not adopted)                                                                                                           |
| `CHANGELOG.md`        | Every doc↔code discrepancy fixed and every value moved into tokens                                                                                    |
| `tokens.json`         | GENERATED spec tokens                                                                                                                                 |
| `components/<Name>/`  | `README.md` (props, variants, states, usage) + `preview.html` (artifact specimen)                                                                     |
| `components/bundle.*` | Preview bundle built from the real components (see `viewer/`)                                                                                         |
| `screens/`            | Screenshots of the running app, mobile 390 @2x and desktop 1280, dark and light                                                                       |
| `design-system.html`  | GENERATED single-file viewer (open offline): brand book, foundations, live components, proposals, screens. `node design-system/viewer/build-html.mjs` |
| `viewer/`             | Specimen sources and the build script for the previews (proposed local viewer: P-13)                                                                  |
| `archive/`            | v0.1 (captured from Stage 04 code) and v1 (an unbuilt proposal) — superseded                                                                          |
| `RELEASES.md`         | Release index: active version, module versions, migration, rollback, history                                                                          |
| `releases/`           | Immutable published releases (`v2.0.0/` …) and `manifest.json`; `candidates/` for composed, unpublished releases                                      |
| `experiments/`        | Proposed changes as isolated, reviewable patches with previews; `approvals.json`                                                                      |
| `versioning/`         | `ds.mjs` (status, verify, approve, preview, compose, publish, adopt, rollback) and `modules.json`                                                     |
