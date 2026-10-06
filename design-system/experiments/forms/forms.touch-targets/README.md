# forms.touch-targets — 44px hit areas for chips and segments

**Status: proposed — not adopted.** Module: Forms · base: v2.0.0 · bump: minor · source: P-11

CheckboxChip (40px) and SegmentedControl segments (34px) get the `hit-area` utility. Visual sizes stay the same.

## Why

P-11. CheckboxChip (40px) and segmented-control segments (34px) fail the 44px target.

## Before / after

|                                     | Before (v2.0.0) | After                                             |
| ----------------------------------- | --------------- | ------------------------------------------------- |
| CheckboxChip tap target             | 40px            | 44px (visual 40px)                                |
| SegmentedControl segment tap target | 34px            | 44px (visual 34px)                                |
| Language chip ✕ (app code)          | 24px            | unchanged; fix in the adoption PR with `hit-area` |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                                   | Owner module | Change       |
| -------------------------------------- | ------------ | ------------ |
| `src/components/creatorco/choices.tsx` | forms        | modify +7 −4 |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** **No.** It needs **tokens.hit-area**, for the same reason as buttons.touch-targets: the class is defined there.
- **Requires:** `tokens.hit-area` — uses the `hit-area` utility that tokens.hit-area adds to globals.css
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

No API change. The language chip's ✕ remove button lives in app code (onboarding about-form) — apply `hit-area` there in the adoption PR.

## Risks and limits

The segment hit areas reach 5px above and below the control; nothing sits that close in the app today.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve forms.touch-targets --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
