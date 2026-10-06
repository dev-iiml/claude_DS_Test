# Select

`NativeSelect` — a native `<select>` styled like Input, so iPhone opens the wheel picker and macOS the menu.

Source: `src/components/ui/select.tsx`. Wrap in **FormField**.

## States

Placeholder option ("Select…") · chosen · disabled (dependent field, e.g. City before State, with a description saying why) · invalid (`errors` on FormField).

## Rules

- Prefer **RadioRow** for ≤ 5 options that benefit from descriptions; NativeSelect for long lists (states, cities, categories).
- Chevron is an `ink-subtle` 16px glyph, `aria-hidden`.
