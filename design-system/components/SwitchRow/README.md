# SwitchRow

iOS toggle: a native checkbox with `role="switch"`, so it submits with forms and VoiceOver says "switch, on/off".

Source: `src/components/creatorco/choices.tsx`.

## Anatomy

Track `w-switch-w × h-switch-h` (51 × 31), thumb `size-switch-thumb` (27) in `bg-thumb` with `shadow-thumb`. Off track `bg-input-border` (≥ 3:1), on track `bg-success`. Transition `--motion-base`.

## States

Off · on · focus-visible (gold outline on the track) · disabled (40%).

## Use

Preferences that apply immediately or on save (PR packages, travel invitations, optional professional signals). For a consent agreement use **CheckboxRow**, not a switch.
