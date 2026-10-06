# typography.devanagari — Devanagari pairing and Hindi text rules

**Status: proposed — not adopted.** Module: Typography · base: v2.0.0 · bump: minor · source: P-10

Adds system Devanagari faces (Kohinoor Devanagari on Apple, Noto Sans Devanagari on Android) after Inter in the sans stack, and `:lang(hi)` rules: body line-height ≥ 1.6, no letter-spacing, no forced uppercase on eyebrows and group labels.

## Why

P-10. Hindi needs a matching Devanagari face, taller lines for matras, and no letter-spacing or forced capitals, which break conjuncts and only space the text out.

## Before / after

|                                | Before (v2.0.0)               | After                                                                    |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| Sans stack                     | … Inter Variable, system-ui … | … Inter Variable, Kohinoor Devanagari, Noto Sans Devanagari, system-ui … |
| Hindi body line-height         | component default (≈ 1.35)    | 1.6 on p, li, dd, label, td, blockquote under `lang="hi"`                |
| Eyebrow / group label in Hindi | uppercase + 0.08em tracking   | no case transform, normal tracking                                       |
| Web fonts downloaded           | Inter, Newsreader             | unchanged; Devanagari uses system fonts                                  |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                            | Owner module          | Change        |
| ------------------------------- | --------------------- | ------------- |
| `src/app/globals.css`           | tokens-themes         | modify +15 −0 |
| `src/design/tokens.ts`          | tokens-themes         | modify +5 −1  |
| `tests/unit/typography.test.ts` | typography (new file) | add +19 −0    |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** Yes. It has no required experiments, but it **changes two files owned by Tokens and themes**: the `fonts` section of `tokens.ts` (typography's own section) and a new block at the end of `globals.css`. The tokens-themes owner must review those lines too. It combines cleanly with every tokens experiment (all 575 valid combinations of the ten experiments were checked).
- **Cross-module files:** `src/app/globals.css` (tokens-themes), `src/design/tokens.ts` (tokens-themes). The owning module's reviewer signs off on these lines as well.
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

No new font downloads (system fonts only). Mark Hindi content with lang="hi" to get the rules. tokens.json `families.sans` changes. Full Hindi consent text still needs a qualified translator.

## Risks and limits

The preview uses Noto Sans Devanagari on both sides only so the comparison has glyphs. On devices the system fonts render it. Translations in the specimen are samples; consent text needs a qualified translator.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve typography.devanagari --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
