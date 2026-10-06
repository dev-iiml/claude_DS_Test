# Design system — proposed upgrades (not adopted)

Status key: **proposed** → **approved** → **done**. Nothing here is a rule yet.

| # | Proposal | Why | Effort | Status |
|---|---|---|---|---|
| P1 | Darken control borders: give secondary buttons, RadioRow/CheckboxRow and CheckboxChip a border that reaches 3:1 on `surface` (e.g. reuse `input-border` #8f897d, 3.4:1), keep `line-strong` for decorative dashes/rules | `line-strong` is 1.7:1 — fails WCAG 1.4.11 non-text contrast for control boundaries | S | proposed |
| P2 | Add a data-visualisation palette (sequential bronze ramp + 4–5 categorical hues tuned to paper) | Financial Eligibility and creator analytics will need charts; nothing exists | M | proposed |
| P3 | Add a dark theme ("ink") as a second token theme, plus `on-brand` / `on-danger` tokens instead of literal white | Premium-finance audiences expect it; prepares for mobile | M | proposed |
| P4 | Adopt Lucide formally (16px, 1.5px stroke, `currentColor`) with a short approved icon list | Installed but unused; upcoming stages (accounts, documents, status) will want icons | S | proposed |
| P5 | Build the missing primitives before Stage 05 screens need them: Dialog, Tabs, Table, Toast, Tooltip, Avatar, File upload — shadcn base, restyled to these tokens | Avoid each stage inventing its own | M | proposed |
| P6 | Replace the default Next.js favicon with a CreatorCo mark (wordmark dot on paper) and add an OG image | Default favicon undercuts the premium feel | S | proposed |
| P7 | Name the money formats: ₹ with Indian digit grouping (1,00,000), lakh/crore rules, tabular figures in all amounts | Financial screens are coming; consistency matters for trust | S | proposed |
| P8 | Add a `shadow-overlay` token used only for floating layers (dialogs, menus) | "Borders, not shadows" works for the page, but overlays need separation | S | proposed |
