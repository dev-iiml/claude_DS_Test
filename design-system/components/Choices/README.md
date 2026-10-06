# Choices

`RadioRow`, `CheckboxRow` and `CheckboxChip` — native inputs stretched transparently over the whole row, so taps, keyboard, VoiceOver and Playwright `check()` all hit the control.

Source: `src/components/creatorco/choices.tsx`.

## Props

- `RadioRow` / `CheckboxRow` — native input props plus `label`, `description?`.
- `CheckboxChip` — native input props plus `label: string`.

## States

| State         | Row                                                          | Chip                          |
| ------------- | ------------------------------------------------------------ | ----------------------------- |
| Unchecked     | `surface`, `ring-line`; indicator ring `ink-subtle` (≥ 3:1)  | `elevated`, `ring-line`       |
| Hover         | `bg-elevated`                                                | `ring-line-strong`            |
| Checked       | `bg-elevated`, `ring-ink/50`; gold indicator with paper tick | inverted: `bg-ink text-paper` |
| Focus-visible | 2px gold outline, offset 2                                   | same                          |
| Disabled      | 45% opacity, not-allowed                                     | 40% opacity                   |

## Rules

- Rows are ≥ 52px (`min-h-choice-row`); chips are 40px (`min-h-chip`) — below 44px, P-11.
- Group with **ChoiceFieldset** (legend + errors).
- Agreement checkboxes start unchecked and say exactly what is agreed ("I agree to …").
