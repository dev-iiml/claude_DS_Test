CreatorCo is a premium professional and financial network for creators in India. The interface is **calm, editorial and high-trust**: warm paper, near-black ink, one restrained bronze accent, a serif for statements and a sans for everything you operate. No gradients, no shadows, no decoration that does not carry meaning. The product sits next to regulated money, so the UI must feel like a private bank's correspondence, not a social app.

> Draft v0.1 — captured from the live code (`src/app/globals.css`, `src/components/ui`, `src/components/creatorco`) at Stages 00–04. The code's values are the source of truth; this system describes them.

## Content fundamentals

- **Voice: plain, precise, unhurried.** Short declarative sentences. Say what happens and what it means for the creator. Real copy: "Your progress is saved after every step, so you can stop and come back."
- **Address the creator as "you"; CreatorCo speaks as "we".** "We'll start with your Creator Professional Profile."
- **Sentence case** for headings, buttons and labels ("Apply for membership", "Profile completion"). Uppercase only through the `eyebrow` style.
- **Indian/British English spelling**: recognising, programmes, personalised. Indian conventions for money and dates when they appear (₹, lakh/crore where natural).
- **Product nouns are capitalised and stable**: Creator Professional Profile, Creator Passport, Creator Status, Financial Eligibility, Access. Status tiers: Member, Onyx, Icon.
- **Regulatory honesty is part of the voice.** Never imply CreatorCo lends. Use the established phrasings:
  - "CreatorCo is not a bank or lender. Any financial product will be offered by a regulated partner bank or NBFC and is subject to its approval."
  - "Any eligibility shown will be a CreatorCo recommendation, subject to partner-lender approval."
  - "Status is about your creator career — it never sets financial limits."
- **Label unfinished or sample things plainly**: "Sample preview", "Coming in the next build", "Declared · not connected", "Pilot build — information shown may be sample data."
- **No emoji, no exclamation marks, no hype** ("unlock", "supercharge"). Use the em dash and middle dot (·) as the code does.
- Pending states name the action: `Saving…`, with a real ellipsis character.

## Visual foundations

### Colour

- Pages sit on `paper`; anything raised (cards, inputs, choice rows) is `surface`. The two differ subtly — separate them with a `line` border, never a shadow.
- Text: `ink` for primary, `ink-muted` for secondary (ledes, descriptions, hints, eyebrows), `ink-subtle` only for tertiary text on `paper`/`surface` (placeholders, "(optional)", legal footer).
- **The primary action is `ink`, not bronze.** `primary` = `ink` with `primary-foreground` = `paper`. `brand` (bronze) is an accent for focus, progress and the wordmark dot; use it as text or a small mark, never a large fill or a button.
- Status colours come in pairs — text colour on its `-soft` ground: `success`/`success-soft`, `warning`/`warning-soft`, `danger`/`danger-soft`, `info`/`info-soft`, `brand`/`brand-soft`. Every pair holds ≥ 5:1. Status is always spelled out in words too; never rely on hue.
- Borders: `line` for decorative hairlines and cards; `input-border` for text inputs and selects (3:1); `line-strong` for secondary buttons, choice rows and chips (see the note on contrast below).
- Selection highlight: `brand-soft` behind `ink`.
- One theme today (light paper). There is no dark theme yet.

### Typography

- Two families: `serif` (Newsreader Variable) for editorial statements and figures; `sans` (Inter Variable, with `cv11` and `ss01` features on) for the interface.
- Serif is for **headings that state something** — `display` (once per page, landing only), `page-heading` (every page's h1), `quote`, `metric`, `serif-title` — always weight 400 with tight tracking. Never bold the serif.
- Sans carries everything you read to act: `section-heading` and `card-title` (600), `body`, `body-ui` (0.95rem for form values and choice labels), `small`, `label` (500), `button`, `badge`, `eyebrow` (uppercase, 0.14em tracking), `legal`.
- Headings use `text-wrap: balance`; ledes use `pretty` and cap at `width-prose`.
- Figures use `tabular-nums`.

### Spacing and layout

- Tailwind's 4px scale; the common steps are `space-2` (label → control, chip gaps), `space-3`, `space-6` (card padding), `space-10` (heading block → content).
- Page gutters: `space-5` on mobile, `space-8` from the sm breakpoint.
- Three frames, each with a 64px (`header-height`) header and a skip link:
  - **PageShell** — signed-in app, `width-app` column, compliance footer.
  - **AuthShell** — two columns at lg: a `surface` aside with the wordmark and a `quote`, and a `width-form` form column.
  - **OnboardingShell** — one calm `width-onboarding` column: progress, eyebrow, heading, lede, then the step.
- Dashboards use a 3-column grid at lg with `space-5` gaps; cards span 1, 2 or 3 columns.
- Grouped tiles (landing pillars) use the 1px-gap trick: a `line`-coloured grid behind `surface` cells, inside one `radius-lg` border.

### Shape, borders, depth

- Radii: `radius-md` (6px) for controls, alerts, rows; `radius-lg` (8px) for cards; `radius-full` for badges, chips, progress bars.
- **Borders, not shadows.** There are no shadow tokens. Hierarchy comes from `paper` vs `surface`, hairlines and type.
- Dashed `line-strong` border = empty state.
- Quiet list emphasis uses a 2px `line-strong` left rule (onboarding welcome).

### States and motion

- Hover: secondary and ghost buttons fill with `accent`; primary darkens to ink at 85%; choice rows darken their border to `ink-subtle`.
- Checked choice rows: border `ink`, fill `paper`. Checked chip: fill `ink`, text `paper`.
- Focus: a 2px solid `ring` (`brand`) outline, offset 2px, on every focusable element (5.7:1 on paper). Inputs also turn their border `ring` on focus.
- Invalid: `aria-invalid` turns the border `danger`; the first error shows under the field in `small` `danger`.
- Disabled: `opacity-disabled` (buttons), `opacity-disabled-field` (fields, rows), `opacity-disabled-chip` (chips); pointer events off.
- Loading: `Skeleton` blocks in `muted` with a pulse; submit buttons swap to a spinner + "Saving…".
- Motion is limited to colour transitions, the skeleton pulse and the spinner. `prefers-reduced-motion` collapses all of it.

### Accessibility rules the code already follows

- Native inputs inside styled rows (radio, checkbox, select) — keep them native.
- Labels, descriptions and errors are wired with ids (`FormField`); grouped choices use `fieldset`/`legend`.
- Errors announce with `role="alert"`, other alerts with `role="status"`; checklists use `aria-live="polite"`.
- Progress uses `aria-current="step"` and screen-reader-only step names.
- Restricted data (GSTIN) is never echoed back into form state or shown in admin views.

**Known contrast gap:** `line-strong` (#c9c2b4) is 1.7:1 on `surface` — below the 3:1 minimum for control boundaries. It is used on secondary buttons, choice rows and chips, whose text labels carry them today. Kept exact; see proposals.

## Logo and iconography

- **Wordmark**: "CreatorCo" in the `wordmark` style (serif, 1.35rem) followed by a 6px `brand` dot. It is built in code (`Wordmark` component); there is no logo file. Never redraw it as an image or alter the dot's colour.
- **Icons**: none in use. `lucide-react` is installed (shadcn's default) but no screen imports it; the only glyphs are the select chevron (inline SVG, 1.5px stroke, `ink-muted`) and the ✓ in the requirement checklist. If icons are introduced, use Lucide at 16px (`size-4`), 1.5px stroke, `currentColor`.
- The favicon is still the framework default.

## Components

Built from shadcn/ui ("new-york", base colour stone) restyled with these tokens, plus CreatorCo-specific pieces. Primitives in `@/components/ui`: Button, Badge, Alert, Card, Input, NativeSelect, Label, Separator, Skeleton. Product pieces in `@/components/creatorco`: headings (Eyebrow, DisplayHeading, PageHeading, SectionHeading, Lede), FormField / ChoiceFieldset / FieldError / FormMessage, RadioRow / CheckboxRow / CheckboxChip, ProgressSteps / ProgressMeter, RequirementChecklist, MetricBlock, EmptyState, StatusBadge / CreatorStatusBadge, SubmitButton, Wordmark, and the three shells.

- Compose pages from these; add new primitives with `npx shadcn add` so they inherit the token aliases, then restyle to match (no shadows, `radius-md`, `ink` primary).
- Previews here are static HTML renditions styled by `components/bundle.css`, which mirrors the components' Tailwind classes.

## Not captured yet

- No dark theme, no high-contrast theme.
- No data-visualisation palette (Financial Eligibility will need one).
- Components not yet built anywhere: dialog, tabs, table, toast, tooltip, avatar, file upload.
- No logo file, no icon set in use, default favicon.
