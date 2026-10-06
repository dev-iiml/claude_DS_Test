# PageShell

PageShell, AuthShell and OnboardingShell are the three page frames; each has a skip link, a 64px header with the Wordmark and (Page/Onboarding) the compliance footer.

Source: `src/components/creatorco/shells.tsx`.

## Use
- **PageShell** — signed-in app (dashboard, admin): `nav?`, `actions?` (sign-out), `homeHref`; main column `width-app`, 40/56px vertical padding.
- **AuthShell** — sign-in/sign-up: `title`, `description?`, `aside?` (defaults to the statement "Your influence opens doors. Your business earns the limit."); two columns at lg.
- **OnboardingShell** — `progress`, `eyebrow`, `title`, `description`, `actions`; single `width-onboarding` column.
- The footer always carries the not-a-lender disclosure and the pilot-data note — keep it on every product page.

_Preview: static HTML rendition styled by `components/bundle.css`._
