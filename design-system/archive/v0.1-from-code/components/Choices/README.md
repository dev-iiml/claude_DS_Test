# Choices

RadioRow, CheckboxRow and CheckboxChip are native radio/checkbox inputs styled as calm tappable rows and pills.

Source: `src/components/creatorco/choices.tsx`.

## Use
- `RadioRow` for a single choice with explanations (business type, GST status) inside a `ChoiceFieldset`.
- `CheckboxRow` for a few independent opt-ins with descriptions (consent items).
- `CheckboxChip` for longer multi-select lists (content categories, languages); the native input is visually hidden.
- Checked rows: `ink` border on `paper`. Checked chip: `ink` fill, `paper` text. Focus shows the `ring` outline on the row.

## Props
Native input props plus `label` and (rows) `description`.

## Note
Row and chip borders use `line-strong` (1.7:1 on surface) — below the 3:1 control-boundary minimum; the label text carries the control today.

_Preview: static HTML rendition styled by `components/bundle.css`._
