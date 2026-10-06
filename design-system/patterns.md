# Responsive application patterns

Mobile-first. One breakpoint changes the navigation model: **`lg` (≥ 1024px)**. Below it CreatorCo behaves like an iPhone app; at and above it like a Mac app. `sm` (≥ 640px) only widens gutters, turns sticky form footers inline and switches carousels to grids.

## Mobile (below `lg`)

- **Top bar** (`AppShell`, `OnboardingShell`): sticky, `size-top-bar` (48px) below the safe area (`pt-safe`), translucent `bar` + `bar-blur`, hairline bottom border. Left: Wordmark (19px) or a gold **Back** link (44px tall). Right: one action (Sign out).
- **Bottom tab bar** (`TabBar`): fixed, translucent, safe-area aware (`pb-safe`, `pl-safe`, `pr-safe`), up to 5 destinations, icon + 11px label, 52px items, active item gold with a heavier stroke. Creator tabs: Home, Passport, Access, Account.
- **Large title** (`PageHeader`) at the top of each tab's content, then **grouped lists** (`ListGroup` / `ListRow`) — the iOS inset-grouped pattern.
- **Bottom-anchored form actions** (`FormFooter`): the primary button is pinned to the bottom on a translucent bar, full width; it sits above the tab bar inside `AppShell` (`--tabbar-offset`) and above the home indicator elsewhere.
- **Pushed screens** inside a tab (Passport → Connect / Signals / Edit) start with `BackLink` (gold chevron + parent title).

## Desktop (`lg` and above)

- **Sidebar** (`Sidebar`): sticky, full height, `size-sidebar` (248px), `surface` at 60%, source-list rows (36px, `rounded-sm`), active row on `elevated` with a gold icon, sign-out in the footer. The top bar and tab bar are hidden.
- **Wider content:** `AppShell` main column grows from `max-w-3xl` to `max-w-5xl` with 40px gutters.
- **Multi-column arrangements:** Home and Passport use a two-column grid — a fixed 420px column for the membership card and verification, and a fluid column for lists (`lg:grid-cols-[minmax(0,420px)_1fr]`; Passport keeps the left column sticky). Cards pair up from `sm` (`sm:grid-cols-2`); Access tiles go 1 → 2 → 3 columns; the risk console shows 5 metric tiles in a row and two list columns.
- **Forms** stay one column, max 42rem (`max-w-2xl`) — never stretch fields across a wide screen.
- **Auth** (`AuthShell`): a brand panel (statement in title type, gold second line) beside a centred form column.

## Clearing fixed bars

Content must never sit under a fixed or sticky bar.

| Situation                              | Rule                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Top of page (mobile)                   | The sticky top bar is in flow; it adds `env(safe-area-inset-top)` itself (`pt-safe`). Content starts 20px below it. |
| Bottom of page inside `AppShell`       | `pb-tabbar` = `env(safe-area-inset-bottom)` + 6rem, so the last row and the compliance note clear the tab bar.      |
| Sticky `FormFooter` inside `AppShell`  | Sits at `bottom: var(--tabbar-offset)` (= `size-tab-bar` + bottom inset); its own bottom padding is 0.75rem.        |
| Sticky `FormFooter` outside `AppShell` | Sits at `bottom: 0` with `padding-bottom: max(0.75rem, env(safe-area-inset-bottom))`.                               |
| Desktop                                | No fixed bars; `--tabbar-offset` is 0 and footers are inline from `sm`.                                             |
| Horizontal insets                      | Bars use `pl-safe`/`pr-safe` or `max(1rem, env(safe-area-inset-left))` so landscape notches never clip content.     |

## Long lists

- **Group** related rows into labelled `ListGroup`s (Passport: Verification, Social accounts, Professional signals, About you, Creator profile, Business, Interests, Recent activity). A group label is the heading; a footer explains provenance or privacy.
- **Summaries link to detail:** a dashboard or Passport group shows 3 rows and a gold **See all** action to a pushed screen (Professional signals). Never show more than ~7 rows in a summary group.
- **Sticky headers** are not used today. For long single lists (proposed for the risk console and activity), group labels may stick under the top bar.
- **Pagination / show more:** none built. Proposed rule: "Show more" (+20 rows) inside creator screens; numbered pagination only in the risk console tables (P-08).
- **Empty groups** show one plain row ("No consents recorded") or an `EmptyState` with the next action — never an empty white box.

## Horizontal previews

The dashboard Access strip is the pattern:

- `flex snap-x snap-mandatory overflow-x-auto` with `snap-start` items at **72% width**, so the next tile **peeks** at the edge and invites a swipe.
- The strip bleeds to the screen edge (`-mx-4 px-4`) so tiles align with the page gutter at rest but scroll edge to edge.
- From `sm` it becomes a static grid (`sm:grid sm:grid-cols-3 sm:overflow-visible`) — no horizontal scrolling on desktop.
- **No hidden-overflow traps:** never put a horizontal scroller inside an `overflow-hidden` parent, never rely on a scrollbar for discoverability (the peek does that), and keep every tile reachable by keyboard (tiles are list items with focusable content when they link).
