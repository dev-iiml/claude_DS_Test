# Wordmark

"CreatorCo" in Newsreader with a gold full stop — a **replaceable placeholder** for the final name.

Source: `src/components/creatorco/wordmark.tsx`. Props: `className?`, `href?` (default `/`). Renders a link with `aria-label="CreatorCo home"`.

## Sizes

22px default (auth, sidebar) · 19px in top bars (`text-[19px]`, documented exception) · on the membership card the same lockup in `membership-ink` + `membership-accent`.

## Replacing the name

Change `wordmark.tsx`, the lockup in `membership-card.tsx`, `src/app/layout.tsx` metadata, `icon.tsx`/`apple-icon.tsx` and the manifest. Copy that says "CreatorCo" (compliance note, consents) changes with legal review.
