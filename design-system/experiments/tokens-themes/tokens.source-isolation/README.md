# tokens.source-isolation — Keep design-system files out of the app's CSS build

**Status: proposed — not adopted.** Module: Tokens and themes · base: v2.0.0 · bump: patch · source: Versioning

Adds `@source not "../../design-system";` to globals.css so Tailwind no longer scans the design-system folder (viewer specimens, previews, experiments, release snapshots) when building the app's CSS. Today about ten unused utility classes from those files end up in the app stylesheet; with this they cannot.

## Why

The app's Tailwind build scans the whole project, `design-system/` included. Measured on v2.0.0: **169 of the 561 utility classes in the app stylesheet come only from design-system files** (viewer specimens, previews, experiments), not from the app. They are unused, so nothing looks different, but they add weight, and an experiment's class names reach the app's CSS before anyone approves them.

## Before / after

|                                       | Before (v2.0.0)               | After                                                     |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| Utility classes in the app stylesheet | 561 (169 from design-system/) | 392, identical to a repo without the design-system folder |
| `globals.css`                         | —                             | `@source not "../../design-system";`                      |
| Tests                                 | —                             | guards that the exclusion stays                           |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                               | Owner module  | Change       |
| ---------------------------------- | ------------- | ------------ |
| `src/app/globals.css`              | tokens-themes | modify +3 −0 |
| `tests/unit/design-tokens.test.ts` | tokens-themes | modify +6 −0 |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** Yes. It's recommended in every release, because until it's adopted, new experiments and previews keep adding unused classes to the app's CSS.
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

No visual change. If a future app file ever imports from design-system/ (it should not), its classes would need an explicit @source.

## Risks and limits

None for the app: no file under `src/` imports from `design-system/`.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve tokens.source-isolation --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
