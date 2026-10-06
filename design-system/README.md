CreatorCo is a premium creator membership and financial identity for creators in India — **not a loan app**. Creators build a Creator Professional Profile (the **Creator Passport**), earn **Creator Status** (Member → Onyx → Icon), unlock **Access**, and can **check financial eligibility** for products issued by a partner bank or NBFC. CreatorCo is not the lender.

**Brand principle:** _Your influence opens doors. Your business earns the limit._

> **Release v2.0.0 (active)** — versioned and immutable; see `RELEASES.md`. Proposed changes are isolated in `experiments/` until a release that includes them is adopted.
>
> **Version 2 — describes the product as built** (Stages 00–07, 3 Oct 2026). The source of truth is `src/design/tokens.ts` and the live components in `src/components`. Where this book and the code disagree, the code wins and the book is wrong — see `CHANGELOG.md`. Anything marked **(proposed)** lives in `PROPOSALS.md` and is not adopted.
>
> **"CreatorCo" is a placeholder wordmark.** The final name is undecided. It appears only in `Wordmark`, `MembershipCard`, `ComplianceNote` and app metadata, so it can be swapped in one pass.

## Design direction

A **premium membership interface**: dark by default, champagne-gold accents, restrained surfaces, built on **iOS/macOS-native patterns** (large titles, inset-grouped lists, translucent bars, a bottom tab bar on iPhone and a source-list sidebar on Mac). The target feeling is the exclusivity of an invitation-only card, expressed with Gen Z confidence — funky yet classy — while staying a credible financial institution.

It is **not**: payday-loan or "instant credit" aesthetics, debt gamification, casino-like reward UI, neon, follower-count vanity, clichéd luxury motifs (crests, filigree, marble), or any other issuer's trade dress or tier names. "Bank" never appears in the brand.

### Where each quality shows up

| Quality                   | Surfaces                                                                       | Allowed expression                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Exclusivity**           | Membership card, Creator Status tiers and reveals, invitations, Access         | The **only** places for richer material, depth (card shadow), sheen, serif type and signature motion. Gold for tier and status.  |
| **Professional identity** | Creator Passport, connected accounts, professional signals, verification marks | Clear, factual, creator-celebrating. Inset-grouped lists, verification glyphs with words, provenance badges. No decoration.      |
| **Financial trust**       | Consent, financial eligibility, disclosures, compliance note, risk console     | Plain, calm, maximum legibility. Ink on paper/surface, info tones for disclosures, versioned text. No gold, no motion, no depth. |

**Open research question:** does the system communicate creator recognition and belonging as strongly as it communicates financial credibility? Two testable variants are in `PROPOSALS.md` (P-12).

## Foundations

### Appearance

Three modes on `<html data-theme="dark|light|system">`: **Dark (default, the signature look)**, **Light**, and **System** (follows `prefers-color-scheme`). The choice is a per-device cookie (`cc_appearance`) set by the Account › Appearance segmented control. In Tailwind, theme-specific styles use the `light:` custom variant; dark is the base. `theme-color` and `color-scheme` follow the mode.

### Colour

Every token below exists in both themes (`tokens.json` → Colors shows both). All text pairs meet WCAG AA in both themes and are checked by `tests/unit/design-tokens.test.ts`.

- **Grounds:** `paper` is the app background (dark `#050506`, light `#f2f2f7` — iOS grouped background). `surface` holds cards and list groups. `elevated` holds inputs, secondary buttons, chips, segmented controls, empty states and pressed rows; in light it equals `surface` (white) and depth comes from rings.
- **Text:** `ink` (primary), `ink-muted` (secondary: descriptions, list values, ledes), `ink-subtle` (tertiary: group labels, footnotes, placeholders, inactive tabs — still ≥ 4.5:1 on every ground).
- **Lines:** `line` and `line-strong` are **decorative only** (hairlines, card rings, progress track) — both are below 3:1. **`input-border` is the control-boundary token** (≥ 3:1 on paper, surface and elevated): field borders, switch off-track, unmet checklist rings, upcoming progress steps.
- **Primary actions:** `primary` on `primary-foreground` — **platinum `#e9e9ee` with `#0a0a0b` text in dark; near-black `#1c1c1e` with white text in light.**
- **Champagne gold** — `gold` `#d8bf92` (dark) / `#7f6230` (light), with `gold-soft` grounds. `brand` is a legacy alias of `gold` (Tailwind `bg-brand` = `bg-gold`).
  - **Permitted:** focus rings, current progress (current step, completion meter), links and inline actions (Back, See all, Edit, Refresh), the active tab, the wordmark dot, tier accents and Icon status, text selection (`gold-soft`).
  - **Not for:** primary buttons, large fills, body text, financial figures, or anything meaning warning or danger. (`Button variant="gold"` exists in code but no screen uses it; keep it for membership moments only — see P-07.)
- **Semantic pairs** (text colour on its `-soft` ground, ≥ 4.5:1 in both themes): `success`/`success-soft` (verified, connected, done; also the switch on-track), `warning`/`warning-soft` (needs attention), `danger`/`danger-soft` (errors, invalid fields, the destructive button), `info`/`info-soft` (disclosures, "Coming soon", derived-signal badges). State is always carried by a word or glyph too, never colour alone.
- **`bar`** — translucent background for the top bar, tab bar and sticky form footer, always with `bar-blur` (saturate 180%, blur `motion-bar-blur` 20px). Text on the composited bar is checked AA.
- **`thumb`** — the switch thumb (white in both themes).
- **Membership material** (theme-independent, the card is a dark object in both appearances): `membership-base`, `membership-ink` (secondary lines at 50–80% opacity, all AA), `membership-accent`, `membership-sheen`, `membership-edge`, `membership-highlight`.
- **Selection:** `::selection` uses `gold-soft` behind `ink`.

### Typography

A **bold sans-serif hierarchy on the system font** — SF Pro on Apple devices, **Inter Variable** as the fallback elsewhere (`fonts.sans`). Sizes follow iOS Dynamic Type "Large" defaults (`type` in tokens; Tailwind `text-<name>` sets size and line height):

| Token         | Size / line | Weight | Used by                                                     |
| ------------- | ----------- | ------ | ----------------------------------------------------------- |
| `large-title` | 34 / 41     | 700    | `PageHeading` — every page title                            |
| `title-1`     | 28 / 34     | 700    | `MetricBlock` values                                        |
| `title-2`     | 22 / 28     | 700    | `SectionHeading`, Access tile titles, card holder name      |
| `title-3`     | 20 / 25     | 600    | Landing pillars, dashboard Access tiles                     |
| `headline`    | 17 / 22     | 600    | Emphasised body (`CardTitle` uses body + semibold)          |
| `body`        | 17 / 22     | 400    | Default text, list labels, field values (fields never < 16) |
| `callout`     | 16 / 21     | 400    | Reserved                                                    |
| `subhead`     | 15 / 20     | 400    | Descriptions, labels, small buttons, inline actions         |
| `footnote`    | 13 / 18     | 400    | Group labels, field help and errors, list details, footers  |
| `caption`     | 12 / 16     | 400    | Compliance note, consent version                            |
| `caption-2`   | 11 / 13     | 400    | Tab-bar labels, membership-card labels                      |

- **Display** (landing/welcome hero, `DisplayHeading`): 40 → 56 → 64px, 700, −0.035em — an intentional responsive exception to the scale.
- **Serif (Newsreader Variable) is reserved for brand moments:** the wordmark (22px, 19px in bars), the membership card, and occasional editorial statements on landing and status reveals. Never for headings, body, data or finance.
- **Mono** (`ui-monospace`/SF Mono) for member numbers and audit event types only.
- **Money (rule):** tabular figures (`tabular-nums`) for every amount; Indian digit grouping (`1,00,000` via `Intl.NumberFormat("en-IN")`); compact amounts use lakh/crore (`₹1.5L`, `₹2.4Cr`), never "K/M" for money; ranges with a spaced en dash (`₹1,50,000 – ₹2,00,000`). No screen shows money yet.
- **Counts** already use `en-IN` compact notation (`46.7K`, `1.5L`).
- **Devanagari:** no Hindi UI ships yet. Apple platforms fall back to the system Devanagari face; the web stack has no Devanagari face (P-10 proposes Noto Sans Devanagari and a 1.6+ line height for Hindi body).

### Spacing

A 4-pt scale (`space` 0–12 → 0–48px; Tailwind's default steps). Page gutters: 16px on iPhone (`px-4`, safe-area aware), 24px from `sm`, 40px from `lg`. Group spacing inside pages is 32px (`gap-8`).

### Shape

`radius`: **sm 8 · md 12 · control 14 · lg 16 · card 20 · xl 22 · pill 999** (`rounded-sm|md|control|lg|card|xl|full`).

| Radius    | Components                                                               |
| --------- | ------------------------------------------------------------------------ |
| `sm` 8    | Sidebar rows, tooltip (proposed)                                         |
| `md` 12   | Skeleton blocks                                                          |
| `control` | Buttons (md), text fields, selects, alerts, Radio/Checkbox rows          |
| `lg` 16   | List groups, empty states, large buttons, the appearance panel           |
| `card` 20 | Cards (`Card`), landing pillars, Access tiles                            |
| `xl` 22   | Membership card                                                          |
| `pill`    | Chips, badges, small and icon buttons, switches, progress bars, BackLink |

Derived (intentional) radii: segmented control 11px outer / 9px segments, checkbox indicator 7px.

### Depth and material — scoped rules

1. **Membership card:** the only place for gradients, sheen and material depth (`shadow-membership-card`, one radial `membership-sheen`, a top `membership-highlight`, an inner `membership-edge` ring).
2. **Switch thumbs and the selected segment:** a small functional shadow (`shadow-thumb`).
3. **Floating surfaces** — sheets, menus, dialogs, toasts (none built yet): one overlay shadow token, `shadow-overlay` (per theme).
4. **Everywhere else:** borders (rings of `line`) and surface contrast. No shadows, no gradients.

Translucent navigation: the top bar, tab bar and mobile `FormFooter` use `bar` + `bar-blur`. Blur is limited to those three bars — never on content, cards or sheets' contents.

### Motion

`motion` tokens: `motion-fast` 150ms (press, colour), `motion-base` 240ms (switches, state changes), `motion-slow` 500ms (progress fill), `motion-spring` `cubic-bezier(0.32, 0.72, 0, 1)`.

- **Press feedback:** buttons scale to 0.98 and drop to 85% opacity (`press` utility); rows tint to `elevated`.
- **`prefers-reduced-motion`:** every transition and animation collapses to ~0ms, `:active` scale is removed, and state changes are instant. No blur transitions exist.
- Signature motion (status reveal, card reveal) is proposed only (P-05).

### Touch target

`MIN_TOUCH_TARGET` = 44px. Fields and buttons are 50/54px, rows 48–52px, tab items 52px, Back links 44px. Compact controls are audited in `accessibility.md`.

## Patterns

See `patterns.md` for the responsive application patterns (mobile top bar + tab bar, desktop sidebar, clearing fixed bars, long lists, horizontal previews) and `trust-and-copy.md` for status-vs-finance separation, verification wording and copy guardrails.

## Components

Primitives (`@/components/ui`, shadcn/ui restyled with tokens): Button, Badge, Alert, Card, Input, NativeSelect, Label, Separator, Skeleton.

Product components (`@/components/creatorco`): AppShell, PageHeader, AuthShell, OnboardingShell, ComplianceNote, Sidebar, TabBar, ListGroup, ListRow, MembershipCard, VerificationMark, SwitchRow, SegmentedControl, RadioRow, CheckboxRow, CheckboxChip, FormField, ChoiceFieldset, FieldError, FormMessage, FormFooter, BackLink, ConsentText, ProgressSteps, ProgressMeter, RequirementChecklist, MetricBlock, EmptyState, StatusBadge, CreatorStatusBadge, SubmitButton, Wordmark, and the headings (Eyebrow, DisplayHeading, PageHeading, SectionHeading, GroupLabel, Lede).

Every component card documents its props, variants and states (loading, unavailable, empty, error, completed where relevant). Previews are rendered from the real components and the generated tokens.

**Missing (proposed, not to be invented ad hoc):** Dialog/Sheet, Tabs, Table, Toast, Tooltip, Avatar, File upload, chart primitives with a dark/light data-visualisation palette — P-08 and P-09.
