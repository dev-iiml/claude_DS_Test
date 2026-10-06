# FormField

FormField is the accessible wrapper that wires a label, optional description and first error to its control; ChoiceFieldset does the same for radio/checkbox groups with a legend.

Source: `src/components/creatorco/form-field.tsx`, `src/components/ui/label.tsx`.

## Use
- Pass the control as a render function: `{(a11y) => <Input {...a11y} name="displayName" />}` — it receives `id`, `aria-invalid`, `aria-describedby`, `aria-required`.
- Fields are required by default in intent; non-required fields show "(optional)" in `ink-subtle` unless `optionalLabel={false}`.
- Only the first error message is shown, in `small` `danger`.
- Stack fields with `gap-7`/`gap-9` (28/36px) inside a form; label → control is 8px.

## Props
- FormField: `id`, `label`, `description?`, `errors?: string[]`, `required?`, `optionalLabel?`, `children(a11y)`
- ChoiceFieldset: `id`, `legend`, `description?`, `errors?`, `required?`, `children`
- FieldError: `id?`, `errors?`

_Preview: static HTML rendition styled by `components/bundle.css`._
