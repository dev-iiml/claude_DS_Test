# membership.verification-derived — “Derived” verification state

**Status: proposed — not adopted.** Module: Membership · base: v2.0.0 · bump: minor · source: P-01

VerificationMark gains a fifth state, `derived` (sparkles glyph, info colour, word “Derived”), for attributes computed from verified data. The four existing states are unchanged.

## Why

P-01. Some Passport attributes are computed from verified data, such as posting consistency. Calling them “Verified” overclaims, and “Self-declared” underclaims.

## Before / after

|                       | Before (v2.0.0)                           | After                                                  |
| --------------------- | ----------------------------------------- | ------------------------------------------------------ |
| States                | verified · declared · attention · missing | + derived (sparkles, info colour, “Derived”)           |
| `VERIFICATION_LABELS` | 4 entries                                 | 5 entries                                              |
| Existing call sites   | —                                         | unchanged; the app's own 4-state type stays assignable |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                                        | Owner module | Change       |
| ------------------------------------------- | ------------ | ------------ |
| `src/components/creatorco/verification.tsx` | membership   | modify +8 −2 |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** Yes.
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

Additive: VerificationState widens to include "derived"; the app's own 4-state type in passport-view.ts stays assignable. Use it only with wording that says what it was derived from.

## Risks and limits

Use it only with a detail line that names the source (“Derived from connected accounts”). Never use it for the Passport as a whole.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve membership.verification-derived --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
