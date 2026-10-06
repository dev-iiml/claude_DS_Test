# financial.money-figure — MoneyFigure: amounts and ranges in Indian format

**Status: proposed — not adopted.** Module: Financial patterns · base: v2.0.0 · bump: minor · source: P-15

A presentational MoneyFigure component and pure formatters (`formatInr`, `formatInrCompact`, `formatInrRange`) for amounts and ranges: en-IN grouping (1,50,000), lakh/crore compact form, tabular figures, ink colours only — never gold, never a tier mark. Screen readers hear ranges as “to”.

## Why

P-15. Amounts must use Indian grouping, lakh/crore wording, tabular figures and no decoration. Today each screen formats its own.

## Before / after

|                           | Before (v2.0.0)                                              | After                                                              |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Amount component          | none (pages use `toLocaleString` / module helpers)           | `<MoneyFigure amount max compact size label />`                    |
| Formatters                | `formatInr` in modules/financial-eligibility/presentation.ts | pure `@/design/money`: formatInr, formatInrCompact, formatInrRange |
| Ranges for screen readers | “₹1,50,000 – ₹2,00,000” read as a dash                       | read as “… to …”                                                   |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                                 | Owner module         | Change     |
| ------------------------------------ | -------------------- | ---------- |
| `src/components/creatorco/money.tsx` | financial (new file) | add +47 −0 |
| `src/design/money.ts`                | financial (new file) | add +30 −0 |
| `tests/unit/money-format.test.ts`    | financial (new file) | add +23 −0 |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** Yes. It only adds new files. The domain module's `formatInr` gives the same output and can switch to `@/design/money` later; that isn't required.
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

Additive. modules/financial-eligibility/presentation.ts keeps its own formatInr; it can import from @/design/money later (same output). Respect the rule that creators never see recommendation figures before partner-lender review.

## Risks and limits

Presentation only. The rule that creators never see recommendation figures before a partner-lender review is enforced by the page, not by this component.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve financial.money-figure --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
