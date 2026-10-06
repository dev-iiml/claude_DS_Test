# Alert

Inline message on a tinted ground; errors are announced assertively, everything else politely.

Source: `src/components/ui/alert.tsx`; `FormMessage` (`src/components/creatorco/form-message.tsx`) renders a form-level error from a server action's `FormState`.

## Props

- `tone`: `info` · `success` · `warning` · `danger` · `neutral` (default `neutral`).
- `title?`: bold first line.
- `role` defaults to `alert` for `danger`, `status` otherwise.
- `FormMessage` — `state: FormState`; renders nothing unless `state.status === "error"`.

## States shown

success (account connected) · info with title (coming in the next build) · warning (connection expired) · danger via `FormMessage` (please check the highlighted fields) · neutral (account disconnected).

## Rules

- `rounded-control`, `text-subhead`, no icon, no border. Links inside are underlined.
- One alert per region, above the content it refers to. Field errors go to **FieldError**, not an Alert.
