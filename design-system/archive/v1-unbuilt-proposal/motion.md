# Motion

Calm and weighted — things settle, they don't bounce. Motion explains what changed; it never celebrates money.

## Tokens

| Token | Value | Use |
|---|---|---|
| `duration-instant` | 100ms | Press feedback (buttons scale to 0.98), toggles |
| `duration-quick` | 180ms | Hover, focus, colour and border changes |
| `duration-calm` | 320ms | Sheets, dialogs, tab content, toasts in/out |
| `duration-reveal` | 1200ms | Signature moments only |
| `ease-standard` | cubic-bezier(0.2, 0, 0, 1) | Default |
| `ease-exit` | cubic-bezier(0.4, 0, 1, 1) | Leaving the screen |
| `ease-reveal` | cubic-bezier(0.16, 1, 0.3, 1) | Signature moments — slow, settles without overshoot |

## Signature moments (the funky part)

1. **Status reveal** — the membership card rises 48px from below with an 18° tilt that settles flat (`duration-reveal`, `ease-reveal`); the Door line draws itself (1.6s, 300ms delay); eyebrow, tier name and reason fade up 200ms apart. Plays once per tier change. No confetti, no sound, no haptics beyond a single light tick.
2. **Invitation** — the Door draws in Rani, then the headline arrives with its italic word last.
3. **Card parallax** — on the membership card screen, the card tilts up to 6° with device motion. Off when reduced motion is on.

## Everyday motion

- Sheets slide up 320ms; dialogs fade + scale from 0.98; toasts slide 8px.
- Skeleton shimmer 1.6s, only after 300ms of waiting.
- Numbers never count up or spin — figures appear in place.

## Never

Bounce/spring overshoot on money, confetti or particle bursts, slot-machine or spinning-wheel effects, pulsing "limit" banners, autoplaying sound, motion that blocks input for more than 400ms (except the one-time reveal, which is skippable).

## Reduced motion

`prefers-reduced-motion: reduce` collapses every animation and transition to near zero; the end state is shown immediately.
