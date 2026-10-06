# tokens.viz-palette — Data-visualisation palette (viz-1…4)

**Status: proposed — not adopted.** Module: Tokens and themes · base: v2.0.0 · bump: minor · source: P-09

Adds four categorical chart colours per theme as tokens (`viz-1`…`viz-4`), validated for colour-vision deficiency and ≥ 3:1 against surface in both themes. Charts can use `stroke-viz-1`, `bg-viz-2` and so on instead of local hex.

## Why

P-09. Charts need colours that don't borrow gold or the status colours, and that work in both themes.

## Before / after

|               | Before (v2.0.0)                                         | After                                                                                                       |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Chart colours | none (only the proposal specimen's local CSS variables) | `viz-1…4` per theme → `--viz-1…4`, `stroke-viz-1`, `bg-viz-2` …                                             |
| Dark values   | —                                                       | #5b8def · #d47a3e · #34a07f · #a273cc                                                                       |
| Light values  | —                                                       | #2f6bd8 · #c4621e · #1b8a68 · #8a52b8                                                                       |
| tokens.json   | 29 colour tokens                                        | 33 colour tokens                                                                                            |
| Tests         | —                                                       | ≥ 3:1 on paper and surface in both themes, never equal to gold; the utilities-exist scan now covers `viz-*` |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                               | Owner module  | Change        |
| ---------------------------------- | ------------- | ------------- |
| `src/app/globals.css`              | tokens-themes | modify +4 −0  |
| `src/design/render-json.ts`        | tokens-themes | modify +4 −0  |
| `src/design/tokens.ts`             | tokens-themes | modify +17 −0 |
| `tests/unit/design-tokens.test.ts` | tokens-themes | modify +8 −1  |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** Yes.
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

Additive. New CSS variables `--viz-1…4` and Tailwind colours `viz-1…4`; tokens.json gains four colour tokens. Never use gold for data. Text stays in ink tokens.

## Risks and limits

Only four categories. A fifth series folds into “Other” or becomes small multiples. Never cycle the colours.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve tokens.viz-palette --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
