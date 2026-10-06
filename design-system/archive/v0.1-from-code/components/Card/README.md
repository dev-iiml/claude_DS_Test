# Card

Card is the bordered `surface` container for a dashboard module, with header, content and optional footer parts.

Source: `src/components/ui/card.tsx`.

## Use
- Dashboard modules: Profile completion, Creator Status, Connected accounts, Financial Eligibility, Access. Span 1–3 columns of the lg grid.
- `CardTitle` (card-title, an h2) + `CardDescription` (small, ink-muted) in `CardHeader`; content in `CardContent` (24px padding).
- `CardFooter` adds a top hairline for actions.
- Nested lists inside a card use a `line` border with `divide-y` rows, `radius-md`.

## Parts
`Card` (section), `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` — all accept `className`.

## Don't
No shadows, no coloured left borders, no tinted card fills.

_Preview: static HTML rendition styled by `components/bundle.css`._
