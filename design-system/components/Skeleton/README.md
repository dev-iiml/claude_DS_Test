# Skeleton

Loading placeholder: `bg-elevated`, `animate-pulse`, `aria-hidden`. Wrap a group in `role="status" aria-label="Loading"`.

Source: `src/components/ui/skeleton.tsx`. Used by `src/app/(app)/dashboard/loading.tsx`.

## Rules

- Mirror the shape of the real content (membership-card aspect, 48px rows).
- Pulse stops under reduced motion (global rule).
- Known gap: `dashboard/loading.tsx` still mirrors the v0.1 layout, not AppShell (P-16, proposed).
