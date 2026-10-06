# TabBar

iPhone bottom tab bar: fixed, translucent (`bar-blur`, 20px blur), safe-area aware; hidden from `lg`.

Source: `src/components/creatorco/app-nav.tsx`. Props: `items: {href,label,icon}[]` (icons: `home` · `passport` · `access` · `account` · `console`).

## States

Active (`aria-current="page"`, gold, stroke 2.2) · inactive (`ink-subtle`, hover `ink-muted`). Cells are 52px (`min-h-choice-row`). Content clears it with `pb-tabbar`.
