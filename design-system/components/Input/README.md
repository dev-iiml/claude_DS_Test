# Input

Single-line text field: 50px (`h-control`), `rounded-control`, 17px text so iOS Safari never zooms on focus.

Source: `src/components/ui/input.tsx` (`fieldClasses` are shared with **Select**). Always wrap in **FormField**.

## States

| State                    | Look                                                    |
| ------------------------ | ------------------------------------------------------- |
| Empty / placeholder      | `bg-elevated`, `border-input`, placeholder `ink-subtle` |
| Filled                   | `text-ink`                                              |
| Focus                    | `border-gold` + 2px `ring-gold/40`                      |
| Invalid (`aria-invalid`) | `border-danger`; message from FormField                 |
| Disabled                 | 50% opacity, not-allowed cursor                         |

## Rules

- Labels sit above the field, never inside it; placeholders are examples ("e.g. Aarohi Makes"), not instructions.
- Use the right `type`/`inputMode`/`autoComplete` (`email`, `new-password`, `tel`).
- Never echo a restricted value (GSTIN) back into form state.
