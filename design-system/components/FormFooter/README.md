# FormFooter

Primary form action pinned above the home indicator on iPhone (translucent `bar-blur`, hairline top, full-width button); inline from `sm`.

Source: `src/components/creatorco/shells.tsx`. Props: `children`, `className?`.

Uses `sticky-footer` (bottom offset `--footer-safe` / `--tabbar-offset`) so it clears the tab bar inside AppShell. Put the last field's spacing above it; one primary action, optionally a secondary.
