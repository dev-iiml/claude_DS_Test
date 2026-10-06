# membership.card-not-payment — Membership card reads as a status object, not a payment card

**Status: proposed — not adopted.** Module: Membership · base: v2.0.0 · bump: minor · source: P-02

The member number is shown as a labelled detail (“Member no.”) in the interface typeface instead of spaced monospace digits, and a visible caption “Membership card — not a payment card” sits under the card.

## Why

P-02. The member number “CC 0000 0001” in spaced monospace reads like a card number. Until a partner-issued card exists, the card should say plainly that it isn't one.

## Before / after

|               | Before (v2.0.0)                                   | After                                                                        |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Member number | `CC 0000 0001`, mono, 0.18em tracking, unlabelled | “MEMBER NO.” label, value in interface type with tabular figures             |
| Caption       | —                                                 | 🔒 Membership card — not a payment card (visible; `caption={false}` to hide) |
| `className`   | applied to the card                               | applied to the outer figure (card + caption); width classes behave the same  |

See it side by side: open `preview.html` in a browser. It contains live components built from the real code, with a Dark/Light switch and, where relevant, “Show 44px hit areas”. `before-after.png` is a dark-theme snapshot.

## What changes

| File                                           | Owner module | Change         |
| ---------------------------------------------- | ------------ | -------------- |
| `src/components/creatorco/membership-card.tsx` | membership   | modify +52 −31 |

The diff is `changes.patch`. Generated files (`tokens.css`, `tokens.json`) are not in the patch; they are rebuilt when a release is composed.

## Dependencies

- **Can be adopted on its own:** Yes.
- **Conflicts:** none. Every combination of experiments that satisfies the requirements applies cleanly onto v2.0.0 (checked: all valid subsets).

## Migration

`className` now applies to the outer figure (card + caption); width classes behave the same. New optional prop `caption` (default true). Optional app follow-up: format numbers as “No. 1A2B3C4D” in memberNumberFor (passport-view.ts).

## Risks and limits

The card's total height grows by the caption (about 28px) on Home and Passport. Optional app follow-up: show the number as “No. 1A2B3C4D” in `memberNumberFor` (passport-view.ts). That's app code and is not part of this experiment.

## Review and approval

```sh
node design-system/versioning/ds.mjs approve membership.card-not-payment --by "<name>"   # or: reject … --note "why"
```

Approval only marks the experiment for the next composed release. Nothing changes in `src/` until a release is published and its adoption is explicitly authorized.
