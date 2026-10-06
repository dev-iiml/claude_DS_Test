# Progress

`ProgressSteps` (step indicator) and `ProgressMeter` (linear completion bar).

Source: `src/components/creatorco/progress.tsx`.

## ProgressSteps

Props: `steps: {key,label}[]`, `currentKey`, `className?`. Shows "Step n of N" and one 4px bar per step: done `bg-ink`, current `bg-gold` (`aria-current="step"`), upcoming `bg-input-border`. Landmark `nav "Onboarding progress"`.

## ProgressMeter

Props: `value` (0–100, clamped), `label`. `role="progressbar"` with min/max/now. Fill `bg-gold` on a `line-strong/60` track; width animates over `--motion-slow`.

## Known issue

A creator who finishes onboarding sees "Complete your Passport — 80%" because connecting an account (20%) is counted but isn't part of onboarding — see P-03 (proposed).
