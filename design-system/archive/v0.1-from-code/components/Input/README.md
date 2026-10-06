# Input

Input and NativeSelect are the text and single-choice controls: 44px tall, `surface` fill, `input-border` outline that turns `ring` on focus and `danger` when invalid.

Source: `src/components/ui/input.tsx`, `src/components/ui/select.tsx`.

## Use
- Always place inside `FormField` so label, description and error are wired by id.
- Use `NativeSelect` (a real `<select>` with a chevron) for simple lists such as city or state — it is the most accessible option on mobile.
- Placeholder text is `ink-subtle`; never use it as a label.

## Props
Native `<input>` / `<select>` props; `aria-invalid` drives the error border.

## Don't
GSTIN is a restricted field — never echo it back into `defaultValue` after a failed submit.

_Preview: static HTML rendition styled by `components/bundle.css`._
