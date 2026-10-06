# Button

Buttons are pills. `primary` is the inverse surface (ink in Chalk, chalk in Onyx); `signature` (Rani) is reserved for status and invitation moments.

## Variants
- `primary` — the one main action in a region ("Continue", "Check financial eligibility").
- `secondary` — outlined alternative.
- `ghost` — toolbar and header actions.
- `signature` — Rani fill; **only** for "Accept invitation", "Reveal your status" and similar membership moments. Never on financial screens.
- `destructive` / `destructive-quiet` — withdraw consent, remove account.
- Sizes: `sm` 36px (console, toolbars), `md` 48px (default), `lg` 56px (bottom-of-screen CTA on mobile, full width).

## States
Hover darkens/fills, press scales to 0.98 (100ms), focus shows the 2px `focus` ring, loading swaps the label for a spinner + verb ("Saving…"), disabled is 45% opacity.

## Copy
Verb first, sentence case, ≤ 3 words where possible: "Check financial eligibility", "Request access", "View receipt". Never "Get instant credit", "Unlock your limit".
