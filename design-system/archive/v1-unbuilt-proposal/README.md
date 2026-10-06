CreatorCo is a premium creator membership and financial identity for India — **not a loan app**. Creators join to build a verified Creator Professional Profile (the Creator Passport), earn Creator Status, open curated access, and — separately, optionally — check financial eligibility for products issued by a partner bank or NBFC. CreatorCo is never the lender, and nothing in this system may imply it is.

**Brand principle:** *Your influence opens doors. Your business earns the limit.*
**Quiet thesis:** CreatorCo understands the professional and economic durability of creators better than conventional financial systems.

**The feeling — funky yet classy.** The black metal card in a fashion-week front row, not a mahogany boardroom. Heritage private-bank confidence × creator-culture energy: calm, editorial, minimal and high-trust, with moments of swagger — an italic word, a Rani dot, a card that rises out of the dark.

> The wordmark "CreatorCo" is a working-name **placeholder** (see the Wordmark card). Everything references one `Wordmark` component, so the real lockup swaps in one place.

## Principles

1. **Earned, not sold.** Membership language, invitation moments, no mass-market urgency.
2. **Status ≠ credit.** Creator Status and financial eligibility never share a surface, a colour or a visual language. Read *Status and finance* before designing either.
3. **Business over vanity.** Figures that lead are earnings consistency, repeat brand partners and Passport completeness — never follower counts.
4. **Calm by default, swagger by exception.** One accent moment per view. Motion is slow and settles; nothing bounces, flashes or celebrates money.
5. **Plain language, two languages.** English and Hindi as equals; Indian number formats everywhere.

## Colour

Two themes from one token set: **Chalk** (light, first) and **Onyx** (dark). Every text pair below meets WCAG AA in both (verified: body text ≥ 4.6:1, control borders and focus ≥ 3:1).

- **Grounds:** `canvas` for pages, `surface` for cards and inputs, `surface-raised` for anything floating, `surface-sunken` for wells, table headers and skeletons, `surface-inverse` for the invitation band, primary buttons and toasts.
- **Text:** `text` primary, `text-muted` secondary, `text-subtle` tertiary only (placeholders, timestamps, legal). `text-inverse` on `surface-inverse`.
- **Lines:** `border` for decorative hairlines; `border-strong` for every control boundary (inputs, checkboxes, toggles, secondary buttons). Focus is a 2px `focus` ring (ink/chalk), offset 2px.
- **Signature accents — use sparingly:**
  - `accent` — **Rani**, the Indian hot pink. The funky one. Wordmark dot, invitation, status reveal, the Icon tier's single line, the one italic flourish. **Max one Rani element per view. Never on financial-eligibility surfaces, charts or errors.** Text on a Rani fill uses `on-accent`.
  - `brass` — the classy one. Member-tier mark, "Repeat" partner tags, member benefits, the sequential chart ramp.
- **Semantic:** `success`, `warning`, `danger` (vermilion — deliberately orange-red so it never reads as Rani), `info` (slate — the colour of disclosures). Each has a `-soft` ground; the text colour on its own soft ground is ≥ 4.6:1. Status is always icon + word, never colour alone.
- **Never:** generic fintech blue as a brand colour, neon, purple-blue gradients, gold-on-black filigree.

### Tier materials (Creator Status only)

| Tier | Material tokens | Mark |
|---|---|---|
| Member | `tier-member-base` matte chalk, `tier-member-edge`, `tier-member-ink` | `tier-member-mark` brass |
| Onyx | `tier-onyx-base` matte black, `tier-onyx-edge` (keeps it visible on the Onyx canvas), `tier-onyx-ink` | `tier-onyx-mark` graphite |
| Icon | `tier-icon-base` → `tier-icon-sheen` smoked titanium (the one sanctioned two-stop gradient, card art only), `tier-icon-edge`, `tier-icon-ink` | `tier-icon-mark` a single Rani line |

Tier materials appear **only** on tier badges, tier cards, the membership card and the status reveal.

### Payment-card finishes (finance)

`card-graphite` and `card-chalk` are cardholder-chosen finishes for the future co-branded card. They are never tied to tier.

### Charts

`chart-1…5` (brass, slate, clay, teal, plum) in that fixed order — validated for colour-vision deficiency in both themes on adjacent pairs. Scatter/bubble: first two only. Sequential `seq-100…600` (brass). Diverging `chart-diverge-neg` / `-mid` / `-pos`. Gridlines `chart-grid`. Text on charts wears text tokens, never series colours.

## Typography

- **Display — Instrument Serif** (`display` family), with **Tiro Devanagari Hindi** for Devanagari: magazine-cover confidence. Weight 400 only; tight tracking. The swagger move is **one italic phrase** inside a display line (`display-italic`): "You've been *invited.*", "Doors open *this week.*" Never a whole italic paragraph.
- **Interface — Instrument Sans** (`sans`), with **Noto Sans Devanagari** for Hindi and the ₹ glyph. Highly legible at 15px on phones.
- **Numbers — Instrument Sans with tabular figures** for money (`num-xl`, `num-lg`, `num`), right-aligned in tables. **IBM Plex Mono** (`mono`, `mono-caps`) for IDs, reason codes, model versions, consent references and card engraving.
- Scale (mobile → desktop): `display-xl` 56→88, `display` 40→64, `h1` 32→44, `h2` 22→26, `h3` 18, `title` 16, `body-lg` 17, `body` 15, `label` 14, `small` 13, `caption` 12, `eyebrow` 11 (uppercase, 0.16em — Latin only).
- **Hindi:** same sizes, line-height 1.75 for body (`body-hi`) and ≥ 1.35 for display. Never uppercase-transform or letter-space Devanagari. Set `lang="hi"` so the `hindi` family applies.

## Indian formats

- Full amounts: `₹1,50,000` (en-IN grouping: `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })`).
- Compact: `₹1.5L`, `₹2.4Cr`, `₹50k` — in stat cards and chart axes only; detail views show the full figure.
- Ranges use an en dash with spaces: `₹1,50,000 – ₹2,00,000`.
- Dates: `3 Oct 2026`; times in IST with the zone on receipts (`14:32 IST`). Mobile: `+91 98200 41xxx`.

## Layout

- **Mobile-first.** 375px reference, 20px (`space-5`) side margins, 4-column grid, 16px gutters. Primary CTA sits at the bottom, full width, `control-lg`.
- **Tablet** 8 columns. **Desktop ≥ 1024px**: 12 columns, 24px gutters, `content-max` 1200px, `sidebar` navigation.
- **Editorial rhythm:** asymmetric 7/5 splits for hero rows (identity left, card right), generous `space-12`/`space-16` between sections, `space-24` on invitation and reveal screens. Forms and consent cap at `reading-max` (640px).
- Spacing steps: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-5` 20 · `space-6` 24 · `space-8` 32 · `space-10` 40 · `space-12` 48 · `space-16` 64 · `space-24` 96.

## Shape and material

- Radii: `radius-xs` 4 (checkboxes), `radius-sm` 8 (inputs, alerts), `radius-md` 12 (cards, toasts), `radius-lg` 20 (feature/access cards, dialogs, sheets), `radius-card` 14 (card art), `radius-full` (buttons, badges, chips, toggles).
- **Buttons are pills; inputs are soft rectangles.** That contrast is part of the look.
- **Depth is quiet.** Pages separate with `border`, not shadow. `shadow-1` for sticky bars, `shadow-2` popovers/toasts, `shadow-3` dialogs/sheets, `shadow-card` only for card art (lift + top-edge highlight).
- **Materials:** *matte* (chalk, onyx — flat fills, faint grain allowed on Onyx card art), *metal* (titanium — the one two-stop sheen, Icon only), *glass* (reserved: a blurred `surface-raised` at 80% for the top bar over photography on access detail pages). No glossy plastic, no holographic foil.

## Iconography

Lucide outline icons, 1.5px stroke, 24px grid, shown at 20px (16px dense, 24px empty states), `currentColor`. Icons always sit with a word except universal controls (close, back, search, more), which carry an `aria-label`. Platforms use neutral glyphs (camera, video, mic) plus the platform's name in text — no vendor logos or colours in tokens. The approved set is in the **Icons** asset group.

## Brand graphics and imagery

- **The Door** — a hairline arch (rectangle with a semicircular head) — carries "your influence opens doors" and nods to Indian architecture without ornament. Invitation, status reveal, card art, empty states. One per view; never filled except on the cover.
- **The Rani dot** — the wordmark's full stop; as a graphic it marks the one thing that is yours.
- **Photography:** real Indian creators at work — studios, kitchens, streets, sets; editorial, natural light, diverse in region, body, gender and age; warm, slightly desaturated grade. Never ring-light heroes, follower overlays, cash or cards in hand. Placeholders here are hatched blocks labelled "Creator photo".
- **Avoid:** crests, laurels, Roman motifs, filigree, confetti, 3D coins, rockets, any card issuer's trade dress, card names or tier names.

## Components and screens

Component cards are grouped Brand · Actions · Forms · Cards · Status · Finance · Passport · Consent · Data · Feedback · Navigation · Overlays · Charts. Screen cards (`Screen01…09`) show the eight key flows mobile-first, the desktop dashboard and the internal risk console.

Previews are static HTML specimens styled by `components/bundle.css`; component props are in `components/index.d.ts`. For the app (Next.js + React + Tailwind v4 + shadcn/ui), see *Implementation*.
