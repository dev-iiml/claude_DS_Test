# RequirementChecklist

RequirementChecklist is a live list of requirements (password rules) that turn `success` with a check as each is met.

Source: `src/components/creatorco/password-checklist.tsx`.

## Use
- Under the password field on sign-up; two columns from sm.
- Updates are `aria-live="polite"`; each item has a screen-reader suffix "— met" / "— not yet met".

## Props
`id`, `items: {key, label, met}[]`, `className?`

_Preview: static HTML rendition styled by `components/bundle.css`._
