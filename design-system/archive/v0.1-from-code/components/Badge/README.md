# Badge

Badge is a small pill that labels state in words; StatusBadge is the workflow wrapper and CreatorStatusBadge shows a member's tier.

Source: `src/components/ui/badge.tsx`, `src/components/creatorco/status-badge.tsx`.

## Use
- `StatusBadge tone` for workflow states: "Declared · not connected" (neutral), "Coming in the next build" (info), "Sample preview" (brand), category chips on the dashboard (brand for the main category, neutral for others).
- `CreatorStatusBadge tier`: `member` → neutral, `onyx` → ink, `icon` → brand. Adds a status dot and a screen-reader prefix "Creator Status:".
- Each tone is text-colour on its `-soft` ground; `neutral` adds a `line-strong` border on `surface`.

## Props
- Badge: `tone`: `neutral` | `brand` | `success` | `warning` | `danger` | `info` | `ink`
- StatusBadge: `tone` (no `ink`), `children`
- CreatorStatusBadge: `tier`: `member` | `onyx` | `icon`

## Don't
- Creator Status reflects professional standing — never pair it with credit amounts or limits.
- Never rely on colour alone; the word is the status.

_Preview: static HTML rendition styled by `components/bundle.css`._
