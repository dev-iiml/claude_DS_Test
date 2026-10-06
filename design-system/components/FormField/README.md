# FormField

Label + control + description + error, wired for assistive tech. Also `ChoiceFieldset` (for radio/checkbox groups) and `FieldError`.

Source: `src/components/creatorco/form-field.tsx`.

## Props

- `FormField` — `id`, `label`, `description?`, `errors?: string[]`, `required?`, `optionalLabel?`, `className?`, and `children: (a11y) => ReactNode` — spread `a11y` (`id`, `aria-describedby`, `aria-invalid`, `aria-required`) onto the control.
- `ChoiceFieldset` — `id`, `legend`, `description?`, `errors?`, `required?`, `children` (RadioRow / CheckboxRow / CheckboxChip).
- `FieldError` — `id?`, `errors?`; renders the first message only, in `danger`.

## States

Default · with description · required · optional (shows "Optional" on non-required fields; `optionalLabel` defaults to `true`) · error (message below, control `aria-invalid`) · disabled option inside a fieldset.

## Rules

- Errors say what to do ("Enter your full legal name."), not what went wrong.
- Descriptions explain privacy where it matters ("Kept private to CreatorCo.").
