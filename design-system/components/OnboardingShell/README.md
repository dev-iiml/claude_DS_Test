# OnboardingShell

Onboarding frame: top bar with Back (or the wordmark on the first step) and actions, ProgressSteps, eyebrow + large title + lede, one column (`max-w-2xl`), ComplianceNote.

Source: `src/components/creatorco/shells.tsx`. Props: `progress?`, `eyebrow?`, `title`, `description?`, `actions?` (Sign out), `backHref?`, `children`.

Each step is a form ending in **FormFooter**. Steps: Welcome · About you · Creator profile · Business status · Professional interests · Creator Profile consent.
