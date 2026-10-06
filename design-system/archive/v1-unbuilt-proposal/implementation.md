# Implementation

Built for **Next.js + React + Tailwind CSS v4 + shadcn/ui**.

## Theme file

`design-system/tailwind/creatorco.css` (in the repo) is generated from `tokens.json`. It defines every token as a CSS variable under `:root` (Chalk) and `[data-theme="dark"]` (Onyx), maps them into Tailwind with `@theme inline`, and sets the shadcn aliases:

| shadcn variable | CreatorCo token |
|---|---|
| `--background` | `canvas` |
| `--foreground` | `text` |
| `--card` | `surface` |
| `--popover` | `surface-raised` |
| `--primary` / `--primary-foreground` | `surface-inverse` / `text-inverse` |
| `--secondary`, `--muted`, `--accent` | `surface-sunken` (shadcn's `accent` is a hover fill) |
| `--muted-foreground` | `text-muted` |
| `--destructive` | `danger` |
| `--border` / `--input` / `--ring` | `border` / `border-strong` / `focus` |
| `--chart-1…5` | `chart-1…5` |

The brand accent (design token `accent`, Rani) is exposed as `--rani` / `bg-rani` / `text-rani` to avoid clashing with shadcn's `accent`.

Theme switching: set `data-theme="dark"` on `<html>`; the custom variant `dark:` follows it.

## Fonts

Self-host via Fontsource: `@fontsource/instrument-serif` (400, 400 italic), `@fontsource-variable/instrument-sans`, `@fontsource/ibm-plex-mono` (400, 500), `@fontsource-variable/noto-sans-devanagari`, `@fontsource/tiro-devanagari-hindi`. Import them in the root layout; families are `font-display`, `font-sans`, `font-mono`, `font-hindi`.

## Component mapping

| Spec card | Build on |
|---|---|
| Button, Link | shadcn `button` — add `signature`, `destructive-quiet` variants; pill radius |
| TextInput, Select, OTPInput | shadcn `input`, native `select`, shadcn `input-otp` |
| Toggle, CheckboxRadio | shadcn `switch`, `checkbox`, `radio-group` |
| FormValidation | shadcn `form` (react-hook-form + Zod) with an error summary |
| ContentCard, StatCard, AccessCard | shadcn `card` |
| CreatorStatus, MembershipCard, CoBrandCard | custom (`components/creatorco/status/*`) |
| EligibilityResult, ScoreBreakdown | custom (`components/creatorco/finance/*`) |
| DataTable, Tabs | shadcn `table` + TanStack Table, `tabs`, `pagination` |
| Alert, Toast, Skeleton | shadcn `alert`, `sonner`, `skeleton` |
| Dialog, Sheet | shadcn `dialog`, `sheet`, `drawer` |
| Charts | shadcn `chart` (Recharts) with `--chart-*` |
| BottomNav, Sidebar, TopBar | shadcn `sidebar` + custom bottom nav |

Keep status components and finance components in **separate folders** so the separation in *Status and finance* is enforced in code review too.

## Money formatting

```ts
export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n); // ₹1,50,000

export const inrCompact = (n: number) =>
  n >= 1e7 ? `₹${+(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${+(n / 1e3).toFixed(0)}k` : inr(n); // ₹1.5L
```

Always render money with `tabular-nums` (`.num` / `font-variant-numeric: tabular-nums`).
