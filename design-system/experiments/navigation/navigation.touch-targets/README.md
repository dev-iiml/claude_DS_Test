# navigation.touch-targets — Touch-size sidebar rows and list actions

**Status: proposed — not adopted.** Module: Navigation · base: v2.0.0 · bump: minor · source: P-11

Sidebar rows grow from 36px to 44px on touch screens (`pointer: coarse`, e.g. iPad) and stay 36px with a mouse. ListGroup header actions (“Refresh”, “See all”) get the `hit-area` utility.

## Why

P-11. Sidebar rows are 36px, which is fine with a mouse and too small on an iPad. Grouped-list header actions (Refresh, See all) are about 20px tall.

## Before / after

|                                               | Before (v2.0.0) | After                   |
| --------------------------------------------- | --------------- | ----------------------- |
| Sidebar row, mouse                            | 36px            | 36px (unchanged)        |
| Sidebar row, touch screen (`pointer: coarse`) | 36px            | 44px                    |
| ListGroup header action tap target            | ~20px           | 44px (visual unchanged) |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                                   | Owner module | Change       |
| -------------------------------------- | ------------ | ------------ |
| `src/components/creatorco/app-nav.tsx` | navigation   | modify +5 −2 |
| `src/components/creatorco/list.tsx`    | navigation   | modify +1 −1 |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** **No.** It needs **tokens.hit-area** for the list actions. The sidebar part works on its own, but it ships as one reviewable unit.
- **Requires:** `tokens.hit-area` — ListGroup actions use the `hit-area` utility that tokens.hit-area adds
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

No API change. Sidebar height on touch devices increases by 8px per row.

## Risks and limits

The `pointer-coarse` sidebar change can't be seen in the desktop preview. Check it on an iPad or with touch emulation.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve navigation.touch-targets --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
