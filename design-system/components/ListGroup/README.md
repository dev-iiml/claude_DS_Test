# ListGroup

iOS inset-grouped list: `ListGroup` (labelled `<section>`) of `ListRow`s separated by hairlines. Maps 1:1 to SwiftUI `List`/`Section`.

Source: `src/components/creatorco/list.tsx`.

## Props

- `ListGroup` — `id?` (labels the section), `label?`, `action?` (top-right, e.g. "Refresh"), `footer?` (footnote under the group), `children`, `className?`.
- `ListRow` — `label`, `detail?`, `value?` (right, `ink-muted`, ≤ 55%), `accessory?` (badge/button), `leading?` (mark/icon), `href?` (whole row becomes a link with a chevron), `className?`.

## States

Static row · link row (hover/active `bg-elevated`) · with value · with accessory (StatusBadge, Button sm) · with leading VerificationMark · gold call-to-action row · empty ("No consents recorded").

## Rules

- Rows ≥ 48px (`min-h-row`). Group footers carry the explanation ("About your creator business — not a credit score.").
- Inline header actions are ~20px tall — below 44px (P-11).
