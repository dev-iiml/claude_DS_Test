# Badge

Small pill labels: `StatusBadge` for workflow state and `CreatorStatusBadge` for the Creator Status tier.

Source: `src/components/ui/badge.tsx` (tones) and `src/components/creatorco/status-badge.tsx`.

## Props

- `Badge` — `tone`: `neutral` · `brand` · `success` · `warning` · `danger` · `info` · `ink` (default `neutral`).
- `StatusBadge` — `tone` (same minus `ink`), `children`.
- `CreatorStatusBadge` — `tier`: `member` · `onyx` · `icon`. Member = neutral, Onyx = ink (inverted), Icon = gold (`brand`). Prefixes the hidden text "Creator Status:".

## Usage in the product

| Text                               | Tone                     | Where                        |
| ---------------------------------- | ------------------------ | ---------------------------- |
| Connected                          | success                  | Passport accounts            |
| Not yet supported                  | neutral                  | unsupported platforms        |
| Coming soon                        | info                     | Financial eligibility card   |
| Preview                            | brand                    | Access header                |
| Verified / Self-declared / Derived | success / neutral / info | signal provenance            |
| down                               | danger                   | risk console provider health |

## Rules

- Text is ≥ 4.5:1 on its `-soft` ground in both themes (tested).
- Tier badges never appear on finance surfaces; finance uses `info` or neutral only (`trust-and-copy.md`).
- Sentence case, one or two words. Never colour alone — the word carries the meaning.
