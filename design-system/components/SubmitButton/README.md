# SubmitButton

Form submit button that reflects pending state and prevents double submits (`useFormStatus`).

Source: `src/components/creatorco/submit-button.tsx`. Props: every **Button** prop plus `pendingLabel?` (default "Saving…").

## States

Idle (children) · pending — `disabled` + `aria-disabled`, a 14px spinner (`animate-spin`, stops under reduced motion) and the pending label ("Completing your profile…").
