# Card

The inset-grouped container: `surface` ground, `rounded-card` (20px), a hairline `ring-line` inset — no shadow.

Source: `src/components/ui/card.tsx` — `Card` (`<section>`), `CardHeader`, `CardTitle` (`<h2>`, body semibold), `CardDescription`, `CardContent` (`p-5`), `CardFooter` (top hairline).

## Use

- Home places **Creator Status** and **Financial eligibility** in separate cards side by side — status and finance never share a card.
- Consent steps put `ConsentText` in `CardContent` and the agreement `CheckboxRow` in `CardFooter`.
- Lists of rows use **ListGroup**, not a Card with dividers.

## Depth

Cards are flat. Shadows are reserved for the membership card (`shadow-membership-card`), the switch thumb and overlays (`shadow-overlay`) — see README › Depth.
