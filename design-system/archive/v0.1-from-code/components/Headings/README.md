# Headings

The heading set — Eyebrow, DisplayHeading, PageHeading, SectionHeading and Lede — gives every page the same editorial top: small uppercase context, a serif statement, a muted lede.

Source: `src/components/creatorco/heading.tsx`.

## Use
- `Eyebrow` above a heading for context ("Membership by application · India", the onboarding step name).
- `DisplayHeading` — landing hero only, at most once per page (3rem, 2.25rem on mobile).
- `PageHeading` — the h1 of every other page (2.25rem, 1.875rem on mobile).
- `SectionHeading` — sans 600 h2 inside a page.
- `Lede` — one or two sentences under the heading, `ink-muted`, capped at 65ch.
- Spacing: eyebrow → heading 12px (20px on the landing), heading → lede 12px, block → content 40px.

## Don't
Never bold the serif or set body copy in it.

_Preview: static HTML rendition styled by `components/bundle.css`._
