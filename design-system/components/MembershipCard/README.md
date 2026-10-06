# MembershipCard

The membership card — a **status object, not a payment card**. Brushed-titanium material from the `membership` tokens; identical in both themes.

Source: `src/components/creatorco/membership-card.tsx`. Props: `displayName`, `handle`, `tier` (`member`·`onyx`·`icon`), `memberSince`, `memberNumber`, `className?`.

## Anatomy

`bg-membership-base`, `ring-(color:--membership-edge)`, one radial `--membership-sheen` highlight, 1px `--membership-highlight` top edge, `shadow-membership-card`, `rounded-xl` (22), aspect 1.586, max width `max-w-membership-card` (420). Text `membership-ink` at 100/80/70/60/50% (all ≥ 4.5:1, tested); tier pill and full stop in `membership-accent`.

## Rules

- Never a card number, expiry, CVV, chip or network mark; never a limit or figure.
- Today's member number "CC 0000 0001" is grouped like a card number — P-02 (proposed) changes it to "No. 0001" and adds "Membership card — not a payment card".
- Tiers differ only by the pill label today; the card material does not change with tier.
