# Button

Button is the single action control: `primary` (ink) for the one main action per view, `secondary` for alternatives, `ghost` for header actions, `link` for inline navigation, `destructive` for irreversible actions.

Source: `src/components/ui/button.tsx` (cva variants) and `src/components/creatorco/submit-button.tsx`.

## Use
- One `primary` per screen region. The landing hero pairs `lg` primary "Apply for membership" with `lg` secondary "Sign in".
- Headers use `sm`: ghost "Sign in" + primary "Apply".
- Wrap a `next/link` with `asChild` for navigation that looks like a button.
- Forms submit with **SubmitButton**: it disables itself while pending and swaps its label for a spinner + `pendingLabel` (default "Saving…").

## Props
- `variant`: `primary` | `secondary` | `ghost` | `link` | `destructive` (default `primary`)
- `size`: `sm` (36px) | `md` (44px, default) | `lg` (48px, 0.95rem)
- `asChild`: render the child element (Radix Slot)
- SubmitButton adds `pendingLabel`.

## Don't
- Don't fill a button with `brand` bronze — primary is `ink`.
- Don't add shadows or icons for decoration; icons inside are sized 16px.

_Preview: static HTML rendition styled by `components/bundle.css`._
