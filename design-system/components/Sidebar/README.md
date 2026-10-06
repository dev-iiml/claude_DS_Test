# Sidebar

macOS source-list sidebar from `lg` (≥ 1024px): wordmark, destinations, footer (Sign out).

Source: `src/components/creatorco/app-nav.tsx`. Props: `items`, `footer?`. Width `w-sidebar` (248), `bg-surface/60`, hairline right border, sticky full height.

States: active row `bg-elevated text-ink` with a gold icon · inactive `ink-muted`, hover `bg-elevated/60`. Rows are 36px — fine for pointer, not touch.
