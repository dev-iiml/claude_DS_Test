# buttons.touch-targets — 44px hit areas for small and link buttons

**Status: proposed — not adopted.** Module: Buttons · base: v2.0.0 · bump: minor · source: P-11

Button size `sm` (36px) and variant `link` get the `hit-area` utility, so every button meets the 44px touch target with no visual change.

## Why

P-11. Small buttons (Connect, Sign out, header Sign in) are 36px and inline link buttons are about 20px. Both fail the 44px target.

## Before / after

|                             | Before (v2.0.0)  | After                        |
| --------------------------- | ---------------- | ---------------------------- |
| `size="sm"` tap target      | 36px             | 44px (visual 36px)           |
| `variant="link"` tap target | line box (~20px) | 44px tall (visual unchanged) |
| API                         | —                | unchanged                    |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                           | Owner module | Change       |
| ------------------------------ | ------------ | ------------ |
| `src/components/ui/button.tsx` | buttons      | modify +6 −3 |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** **No.** It needs **tokens.hit-area**. The class it adds, `hit-area`, is defined by that experiment. Released alone, the class would match nothing: the build would pass, but the touch target would still fail silently. `compose` refuses this and explains why. Approve tokens.hit-area as well, or leave buttons.touch-targets out.
- **Requires:** `tokens.hit-area` — uses the `hit-area` utility that tokens.hit-area adds to globals.css; without it the class does nothing and the touch target still fails
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

No API change. Small buttons placed closer than 8px apart now have overlapping hit areas; keep at least `gap-2` between them.

## Risks and limits

Small buttons less than 8px apart get overlapping hit areas. Keep `gap-2` or more.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve buttons.touch-targets --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
