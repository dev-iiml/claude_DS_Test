# SegmentedControl

iOS segmented control — a radio group in a fieldset with a visually hidden legend.

Source: `src/components/creatorco/choices.tsx`. Props: `name`, `legend`, `options: {value,label}[]`, `value?`/`defaultValue?`, `onChange?`, `className?`.

## States

Unselected segment `ink-muted` · selected `bg-ink text-paper shadow-thumb` · focus-visible gold outline.

## Use

Account › Appearance (Dark · Light · System). For ≤ 4 mutually exclusive views; segments are 34px (`min-h-segment`), below the 44px touch target (P-11). Inner radii 11/9px are a documented exception.
