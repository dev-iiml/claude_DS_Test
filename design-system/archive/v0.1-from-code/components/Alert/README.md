# Alert

Alert is an inline message block in one of five tones; FormMessage uses it for form-level errors.

Source: `src/components/ui/alert.tsx`, `src/components/creatorco/form-message.tsx`.

## Use
- `success` after completing a journey ("Your Creator Professional Profile is complete. Welcome to CreatorCo.").
- `danger` for form-level failures — rendered by `FormMessage` from a `FormState` with `status: "error"`.
- `neutral` for quiet notes on `surface`; `info` / `warning` for context and caution.
- `danger` announces with `role="alert"`; all others use `role="status"`.

## Props
- `tone`: `info` | `success` | `warning` | `danger` | `neutral` (default)
- `title`: optional bold first line
- `children`: body text; links inside are underlined

_Preview: static HTML rendition styled by `components/bundle.css`._
