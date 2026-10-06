# Button

The one action control — iOS-style filled, tinted and plain buttons with token press feedback.

Source: `src/components/ui/button.tsx` (shadcn/ui, cva variants). Import from `@/components/ui/button`.

## Props

| Prop      | Values                                                                                                                                                           | Default   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `variant` | `primary` · `secondary` · `ghost` · `link` · `destructive` · `gold`                                                                                              | `primary` |
| `size`    | `sm` (`h-button-sm`, 36px, pill) · `md` (`h-control`, 50px, `rounded-control`) · `lg` (`h-control-lg`, 54px, `rounded-lg`) · `icon` (`size-touch`, 44px, circle) | `md`      |
| `asChild` | render the child (e.g. `next/link`) with button styles                                                                                                           | `false`   |

Plus every native `<button>` prop.

## Variants

- **primary** — `bg-primary text-primary-foreground` (platinum on near-black in dark; near-black in light). One per view region.
- **secondary** — `bg-elevated` + `ring-line`. Alternatives ("I'm a member", "Connect").
- **ghost** — text only, `hover:bg-elevated`. Header actions ("Sign out").
- **link** — gold text, underline on hover. Inline navigation.
- **destructive** — `bg-danger-soft text-danger`. Disconnect, withdraw.
- **gold** — `bg-gold text-paper`. **Unused in the product today**; reserved for invitation/status moments (P-07, proposed).

## States

Default · hover (ghost/link) · pressed (`press` utility: scale `motion.pressScale` 0.98, opacity 0.85; none under reduced motion) · focus-visible (global gold outline) · disabled / `aria-disabled` (40% opacity, no pointer) · pending (use **SubmitButton**).

## Use

- Full-width on iPhone inside **FormFooter**; inline from `sm`.
- Icons inside are 18px and `aria-hidden`; icon-only buttons need `aria-label`.
- `sm` (36px) fails the 44px touch target — see `accessibility.md`, P-11.

## Don't

- Don't use gold for primary flow actions; gold is for selection, focus, links and tier.
- Don't hard-code colours or heights; use the variants.
