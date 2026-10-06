# tokens.hit-area — 44px hit-area utility

**Status: proposed — not adopted.** Module: Tokens and themes · base: v2.0.0 · bump: minor · source: P-11

Adds a `hit-area` utility that extends a control's tappable area to the 44px touch target with an invisible ::before, without changing how it looks. It reads the existing `--touch-target` token (MIN_TOUCH_TARGET), and a test keeps the two in sync.

## Why

The touch-target audit in `accessibility.md` found five control types under 44px. Making them bigger would change the layout. A hit area fixes the tap target and leaves the visuals alone.

## Before / after

|                                           | Before (v2.0.0)                                   | After                                                                            |
| ----------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Tap target of a 36px pill with `hit-area` | 36px (not available)                              | 44px; the visual size is still 36px                                              |
| `globals.css` utilities                   | safe-area, tabbar, sticky-footer, bar-blur, press | + `hit-area`                                                                     |
| Tests                                     | —                                                 | the utility reads `--touch-target`, and that variable renders `MIN_TOUCH_TARGET` |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                               | Owner module  | Change        |
| ---------------------------------- | ------------- | ------------- |
| `src/app/globals.css`              | tokens-themes | modify +18 −0 |
| `tests/unit/design-tokens.test.ts` | tokens-themes | modify +7 −0  |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** Yes. It adds a utility that nothing uses yet, so on its own it changes nothing you can see.
- **Required by:** `buttons.touch-targets`, `forms.touch-targets`, `navigation.touch-targets`. Those can't be released without this one.
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

Additive. No component uses the utility until a buttons/forms/navigation experiment applies it. Don't put `hit-area` on an element that already uses ::before.

## Risks and limits

`hit-area` sets `position: relative` and uses `::before`. Don't put it on an absolutely positioned element or on one that already draws a `::before`.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve tokens.hit-area --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
