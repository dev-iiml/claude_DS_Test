# FormValidation

Forms validate on blur, then live once a field has been touched; the submit re-checks everything and moves focus to an **error summary** at the top that links to each field.

## Pattern
1. Error summary (`a-danger` alert, role="alert") listing fields as links.
2. Each field: red border + message with icon, `aria-invalid`, `aria-describedby`.
3. Primary button stays enabled — clicking it explains what's missing rather than silently doing nothing.
4. Progress saved after each step; say so.

Used in onboarding, consent and the eligibility application.
