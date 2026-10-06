# RequirementChecklist

Live list of requirements (password rules) that updates as the creator types; announced politely.

Source: `src/components/creatorco/password-checklist.tsx`. Props: `id`, `items: {key,label,met}[]`, `className?`.

## States

Met — `success` text, filled success disc with a paper tick, hidden " — met". Not yet met — `ink-muted` text, `input-border` ring, hidden " — not yet met".

Two columns from `sm`. Link the field to it with `aria-describedby`.
