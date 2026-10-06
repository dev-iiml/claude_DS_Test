# Progress

ProgressSteps shows where a creator is in a multi-step journey; ProgressMeter shows linear completion.

Source: `src/components/creatorco/progress.tsx`.

## Use
- `ProgressSteps` at the top of every onboarding step: "Step N of M" in `small` muted, then 4px segments — done `ink`, current `brand`, upcoming `line-strong` at 60%.
- `ProgressMeter` for profile completeness: 6px `line` track, `ink` fill, `role="progressbar"`.

## Props
- ProgressSteps: `steps: {key, label}[]`, `currentKey`
- ProgressMeter: `value` (0–100, clamped), `label`

_Preview: static HTML rendition styled by `components/bundle.css`._
