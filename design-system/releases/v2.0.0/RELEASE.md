# v2.0.0 — baseline (formalized)

**Published 3 Oct 2026. Active.** This release formalizes the design system the app already uses. It is a snapshot of the developer's working files at publication time. Nothing in `src/` was changed to create it.

## What it contains

Seven modules, 37 files, listed in `modules.json` with SHA-256 hashes in `checksums.sha256`:

| Module | Files |
| --- | --- |
| Tokens and themes | `tokens.ts` (colours, membership material, shadows, radius, spacing, sizes, motion), the CSS/JSON renderers and scripts, generated `tokens.css` and `design-system/tokens.json`, `globals.css`, `cn.ts`, Card, Separator, Skeleton, the `creatorco` barrel, the token tests |
| Typography | font stacks and type scale (sections of `tokens.ts`), heading roles, Label, Wordmark |
| Buttons | Button, SubmitButton |
| Forms | Input, NativeSelect, Alert, FormField/ChoiceFieldset/FieldError, FormMessage, choice controls, RequirementChecklist, ProgressSteps/ProgressMeter |
| Navigation | TabBar/Sidebar, shells (AppShell, OnboardingShell, AuthShell, PageHeader, FormFooter, BackLink, ComplianceNote), ListGroup/ListRow, EmptyState |
| Membership | MembershipCard, StatusBadge/CreatorStatusBadge, VerificationMark, Badge |
| Financial patterns | ConsentText, MetricBlock |

## Source

- The v2 documentation pass: dark default, champagne gold, iOS/macOS patterns, values moved into tokens, and non-text contrast fixes. See `design-system/CHANGELOG.md`.
- The developer's later edits included in the snapshot:
  - `app-nav.tsx` adds the underwriting, integrations, approvals and jobs icons, and highlights only the most specific matching nav item.
  - `progress.tsx` adds an optional `label` on ProgressSteps.

## Validation at publication

Run on the developer's current code: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm test` ✓ (357 tests). Accessibility limits are unchanged; see `design-system/accessibility.md`.

## Migration

None. This is the starting point.

## Rollback

v2.0.0 is the first versioned release, so there is nothing earlier to roll back to. To restore it later:

```sh
node design-system/versioning/ds.mjs rollback 2.0.0 --authorized-by "<name>"
```
