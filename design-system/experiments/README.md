# Design-system experiments

Proposed changes to the design system. Each one is reviewed and approved on its own. **None of them is adopted.** The app never imports anything from this folder. An experiment reaches `src/` only through a composed, published release whose adoption has been explicitly authorized (see `../versioning/README.md`).

Every experiment folder contains:

| File               | What                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `experiment.json`  | Module, base release, requirements, new files, migration note, preview setup                                                 |
| `README.md`        | Why, before/after table, files changed (and which module owns them), dependency notes, migration, risks                      |
| `CHANGELOG.md`     | The experiment's own history                                                                                                 |
| `changes.patch`    | The exact diff against its base release                                                                                      |
| `preview.html`     | Live before/after comparison built from the real components (open in a browser; Dark/Light; hit-area overlay where relevant) |
| `before-after.png` | Dark-theme snapshot of the preview                                                                                           |
| `specimens.tsx`    | Preview-only specimens (optional)                                                                                            |

Approval decisions live in `approvals.json`. Change them with `ds.mjs approve|reject|reset <id> --by "<name>"`.

## Index — all based on v2.0.0

| Experiment                                                                              | Module             | Source     | What it does                                                                                 | Adopt alone?                          |
| --------------------------------------------------------------------------------------- | ------------------ | ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| [tokens.source-isolation](tokens-themes/tokens.source-isolation/README.md)              | Tokens and themes  | versioning | Stops Tailwind from scanning `design-system/` for the app's CSS (removes 169 unused classes) | Yes · recommended first               |
| [tokens.hit-area](tokens-themes/tokens.hit-area/README.md)                              | Tokens and themes  | P-11       | `hit-area` utility: 44px tap target, no visual change                                        | Yes                                   |
| [tokens.viz-palette](tokens-themes/tokens.viz-palette/README.md)                        | Tokens and themes  | P-09       | `viz-1…4` chart colours per theme                                                            | Yes                                   |
| [typography.devanagari](typography/typography.devanagari/README.md)                     | Typography         | P-10       | System Devanagari faces; Hindi line-height, no tracking/caps                                 | Yes (touches two tokens-themes files) |
| [buttons.touch-targets](buttons/buttons.touch-targets/README.md)                        | Buttons            | P-11       | `sm` and `link` buttons reach 44px                                                           | **No — needs tokens.hit-area**        |
| [forms.touch-targets](forms/forms.touch-targets/README.md)                              | Forms              | P-11       | Chips and segments reach 44px                                                                | **No — needs tokens.hit-area**        |
| [navigation.touch-targets](navigation/navigation.touch-targets/README.md)               | Navigation         | P-11       | Sidebar rows 44px on touch; list actions 44px                                                | **No — needs tokens.hit-area**        |
| [membership.card-not-payment](membership/membership.card-not-payment/README.md)         | Membership         | P-02       | Labelled member number; “not a payment card” caption                                         | Yes                                   |
| [membership.verification-derived](membership/membership.verification-derived/README.md) | Membership         | P-01       | Fifth verification state: Derived                                                            | Yes                                   |
| [financial.money-figure](financial/financial.money-figure/README.md)                    | Financial patterns | P-15       | `MoneyFigure` and pure rupee formatters (lakh/crore)                                         | Yes                                   |

## Dependencies

```
tokens.hit-area ─┬─▶ buttons.touch-targets
                 ├─▶ forms.touch-targets
                 └─▶ navigation.touch-targets
```

Everything else has no requirements. Three kinds of coupling are tracked:

1. **Requires.** One experiment uses something another adds, such as the `hit-area` class. `compose` refuses to build a release where an approved experiment's requirement is not approved, and explains why.
2. **Cross-module files.** An experiment changes a file that another module owns. typography.devanagari edits the `fonts` section of `tokens.ts` and appends to `globals.css`, and both files belong to Tokens and themes. That is not a dependency, but the owning module's reviewer signs off on those lines too. Release notes list these changes.
3. **Conflicts.** Two patches change the same lines. There are none today. All 575 combinations of the ten experiments that satisfy their requirements apply cleanly onto v2.0.0. If a future experiment conflicts, `compose` names both and the later one is rebased (`ds.mjs workspace` / `save`).

## Validation already run (3 Oct 2026)

- Each experiment on its own: patch applies; `npm run tokens`; unit tests for the files it touches.
- All ten together, in a disposable copy of the repo: lint ✓, typecheck ✓, unit tests ✓, integration tests ✓, production build ✓.
- A selective set (tokens.hit-area, buttons.touch-targets, tokens.viz-palette, typography.devanagari, membership.card-not-payment, financial.money-figure): lint, typecheck and unit tests ✓. Publishing, adopting and rolling back that set in the copy left `src/` byte-identical to v2.0.0. Tampering with a published file was detected by `verify`.

The real repo's approvals are all **proposed**. No release beyond v2.0.0 exists.
