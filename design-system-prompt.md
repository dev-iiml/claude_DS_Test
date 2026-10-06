# Design System Prompt — CreatorCo (working name) · v2

> Paste everything below the line into Claude (Design System type), ideally updating the existing "CreatorCo" Design System artifact rather than starting a new one. The brand name is a placeholder — keep "CreatorCo" as a swappable wordmark.

---

Evolve the existing **CreatorCo** design system (draft v0.1, in `design-system/`) into v1. Treat the wordmark "CreatorCo" as a replaceable placeholder — the final brand name is not decided.

## 0. Start from what exists — do not start from scratch

- The repo already has a design system: `design-system/README.md`, `tokens.json`, `PROPOSALS.md`, `USAGE.md`, and component specs/previews in `design-system/components/*`.
- **The spec has drifted from the code.** The v0.1 spec describes a light "warm paper" theme (#f6f4ef paper, bronze #7a5a2c accent, 6px radius, Newsreader + Inter, "no dark theme"). The code (`src/design/tokens.ts` → `tokens.css` → `globals.css`) is now **dark-first, iOS/macOS-native**: near-black paper #050506, gold #d8bf92 accent, 8/12px radii, SF Pro system sans with Inter fallback, Newsreader serif, and a light theme via `data-theme`.
- **Single source of truth = `src/design/tokens.ts`.** Reconcile the spec, `tokens.json` and component docs to it first, then design v1 changes on top. List every discrepancy you resolve.
- Respect the established conventions: shadcn/ui primitives restyled with tokens; product components in `@/components/creatorco`; pure token modules reusable by native apps; never hard-code hex in components.

## 1. What the product is

CreatorCo is a **premium creator membership and financial identity** — not a loan app. Creators build a verified Creator Professional Profile (the "Creator Passport"), earn Creator Status, unlock curated Access (brand drops, events, experiences), and can check financial eligibility for products issued by a **partner bank/NBFC**. CreatorCo is not the lender; the design must never imply it is.

Brand principle: **"Your influence opens doors. Your business earns the limit."**

## 2. Audience

- **Primary — Gen Z (≈18–29):** Indian creators, mostly individual/sole-proprietor professionals who are monetising. Internet-native, status-aware, allergic to corporate stiffness.
- **Secondary — Millennials (≈30–45):** established creators who value polish, credibility and speed.
- **Tertiary — Gen Alpha (future):** the system should age well — bold, simple, legible, icon-friendly.
- **Internal:** risk analysts using a dense data console (§9).

Market: India — mobile-first, Hindi/English (Devanagari support), Indian number formats (₹1,00,000 · ₹1.5L).

## 3. The feeling — "funky yet classy"

Target emotion: owning an **American Express Centurion** — exclusive, earned, invitation-feeling, quietly powerful — expressed with **Gen Z swagger** rather than old-money stiffness. Heritage-private-bank confidence × creator-culture energy: a black metal card in a fashion-week front row.

The dark-first "black card" direction in the code is the baseline. It must still feel like a **serious, trustworthy financial institution** — credible enough to connect a bank account to and for a regulated partner to co-brand.

**Balance two needs (open research question):** v0.1 leaned toward "private-bank correspondence" — strong on financial credibility, weaker on **creator recognition and belonging**. v1 should keep the credibility while making creators feel seen, celebrated and part of something. Show how the system expresses both (e.g. editorial creator moments, status reveals, community/Access surfaces) and propose 1–2 alternative accent/motion treatments we can test with creators.

Required: premium, calm, editorial, minimal, high-trust, modern, creator-native, exclusive, with controlled moments of playfulness.

Avoid: payday-loan or instant-credit aesthetics; aggressive APR/limit banners; debt gamification, casino-like UI, confetti on credit outcomes; heavy gradients, neon overload, generic fintech blue; follower-count vanity as a hero; clichéd luxury (filigree, Roman motifs, crests); anything resembling Amex or other issuers' trade dress, card names or tier names. No "bank" in the CreatorCo brand.

## 4. Brand architecture

- Membership brand (placeholder wordmark).
- **Creator Status tiers: Member → Onyx → Icon.** Distinct material/colour/badge/card-art per tier. Icon should feel invite-only and rare — the understated "Centurion moment".
- **Status ≠ creditworthiness.** Keep status visuals structurally separate from financial-eligibility visuals. A status change must never look like a limit increase. Existing copy: "Status is about your creator career — it never sets financial limits."
- Future co-branded card: metal + virtual card art per tier, with mandatory space for "Issued by [Partner Bank]" and network marks.

## 5. Foundations (dark-first, plus light)

1. **Colour** — reconcile to `tokens.ts`; semantic tokens for both themes; tier tokens (Member/Onyx/Icon); add `on-brand` / `on-danger` instead of literal white. **Fix non-text contrast:** `line-strong` is ~1.7:1 on `surface` in both themes yet is used for toggle tracks, chips and choice-row hover — every control boundary/state indicator must reach **≥3:1** (WCAG 1.4.11); keep `line-strong` for decorative rules only.
2. **Data-visualisation palette** — sequential gold ramp + 4–5 categorical hues tuned for dark and light; accessible, never colour-only.
3. **Typography** — Newsreader serif for statements/figures, system sans (SF Pro → Inter) for UI, tabular figures for all money; Devanagari pairing; full type scale.
4. **Money & date formats** — ₹ with Indian grouping, lakh/crore rules, tabular numerals.
5. **Spacing, grid, layout** — mobile-first; safe areas; editorial desktop grid.
6. **Shape, depth & material** — radius scale; borders-first hierarchy plus a single `shadow-overlay` for floating layers only; a material language (matte, metal, glass) for tiers.
7. **Iconography** — formalise Lucide (16px, 1.5 stroke, `currentColor`) with an approved list.
8. **Motion** — calm iOS-like easing; one or two signature moments (status reveal, card reveal) that delight without gamifying; full `prefers-reduced-motion` support.
9. **Brand assets** — favicon/app icon and OG image replacing defaults (placeholder mark).
10. **Voice & tone** — keep v0.1 rules (plain, precise, "you"/"we", sentence case, Indian/British spelling, no emoji/hype, regulatory honesty), with slightly more warmth and wit in recognition moments.

## 6. Components

Compatible with **Next.js + React + Tailwind CSS v4 + shadcn/ui**.

- Keep and reconcile existing: Button, Badge, Alert, Card, Input, NativeSelect, Label, Separator, Skeleton, headings, FormField/ChoiceFieldset, RadioRow/CheckboxRow/CheckboxChip, ProgressSteps/ProgressMeter, RequirementChecklist, MetricBlock, EmptyState, StatusBadge/CreatorStatusBadge, SubmitButton, Wordmark, shells, ListRow.
- **Add missing primitives:** Dialog, Sheet, Tabs, Table, Toast, Tooltip, Avatar, File upload.
- Product pieces: Creator Passport header/sections; connected-account chips (neutral, no vendor names in tokens); tier card (Member/Onyx/Icon); purpose-specific consent cards with version, receipt and withdraw; financial-eligibility result with required disclaimers; Access/opportunity card; charts (sparkline, line, bar, component-score breakdown).

## 7. Experience patterns to design (from the v0.1 review)

1. **Completion that can be finished.** Profile completion currently tops out at 80% from onboarding because "Connect a creator account" carries 20% and happens later in the Passport. Design completion so finishing onboarding *feels* complete — e.g. separate "Profile complete" from "Verification strength", or bring connection into onboarding — and give the dashboard a clear, rewarding next step rather than an outstanding-task list.
2. **Immediate value on the dashboard.** Priority: identity & status → Creator Passport → financial eligibility → Access → opportunities → rewards. Debt must not dominate. Show at least one useful action or insight a creator gets *today*, not only future capabilities.
3. **Account vs application vs membership.** Make the relationship explicit in UI and copy: does signup create an account, does completing onboarding grant Member status or start a review, and what happens next. Design the states (applied, under review, member, invited to Onyx/Icon).
4. **Optional verification must look optional.** Mobile/PAN name prefill currently sits above manual name entry and GST lookup above business declarations. Give manual entry and verification equal footing (or manual first), and design clear "optional · faster with verification" patterns so creators don't feel obliged to share identifiers.
5. **Mobile reading burden.** Long platform lists, explanatory copy and stacked cards make long pages. Use progressive disclosure, scannable summaries, one primary action per screen, and collapsible "why we ask" explanations.
6. **Clearly labelled sample/demo states** ("Sample preview", "Declared · not connected", "Coming in the next build").

## 8. Key screens to demonstrate (mobile-first, dark and light)

Landing/invitation · Signup · Onboarding (about, business, interests, consent, welcome) · Dashboard · Creator Passport (incl. connect account) · Status tier reveal · Consent & receipt · Financial eligibility result · Access list · Membership card per tier.

## 9. Internal risk console

Same system, higher density: application list, side-by-side **Traditional vs Creator-enhanced** recommendation, component scores, reason codes, fraud flags, completeness, model version, audit trail. Precision over flair; light theme acceptable as default here.

## 10. Copy guardrails

Use: "Check financial eligibility", "CreatorCo recommendation", "Proposed eligibility", "Subject to partner-lender approval", "Creator Status", "Creator Professional Profile", "Financial Capacity", and the existing line "CreatorCo is not a bank or lender. Any financial product will be offered by a regulated partner bank or NBFC and is subject to its approval."

Never: "CreatorCo approved your loan", "Guaranteed credit", "Instant loan", "Followers determine your credit", "AI says you deserve ₹X", "Increase your status to get more debt".

## 11. Deliverables

- Reconciled v1 tokens (dark + light, tier, data-viz, money formats) with a changelog of spec↔code discrepancies resolved.
- Component specimens with all states; the new primitives.
- **Previews that render from the real tokens/components** (the current `preview.html` files don't load any styling) — or a clear plan for a local component viewer.
- The key screens and experience patterns above.
- Updated `PROPOSALS.md` status for P1–P8 and do/don't guidelines (status vs finance, accent usage, motion, optional verification, copy).
- Keep the wordmark a clearly replaceable placeholder.
