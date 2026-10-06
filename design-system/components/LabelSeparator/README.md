# Label and Separator

Two small primitives: `Label` (Radix label, 15px medium) and `Separator` (a 1px `line` hairline `<hr>`).

Source: `src/components/ui/label.tsx`, `src/components/ui/separator.tsx`.

## Use

- Most fields get their label from **FormField**; use `Label` directly only for custom controls.
- `Separator` divides regions of a page; inside lists, rows already have hairlines.
