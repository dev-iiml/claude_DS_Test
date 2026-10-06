// CreatorCo component props — documentation transcribed from src/components (not type-checked here).
import type * as React from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

/** @/components/ui/button */
export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "ghost" | "link" | "destructive";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
}
/** @/components/creatorco/submit-button — useFormStatus-aware submit */
export interface SubmitButtonProps extends ButtonProps {
  pendingLabel?: string;
}

/** @/components/ui/badge */
export interface BadgeProps extends React.ComponentProps<"span"> {
  tone?: Tone | "ink";
}
/** @/components/creatorco/status-badge */
export interface StatusBadgeProps {
  tone?: Tone;
  children: React.ReactNode;
}
export interface CreatorStatusBadgeProps {
  tier: "member" | "onyx" | "icon";
}

/** @/components/ui/alert */
export interface AlertProps extends React.ComponentProps<"div"> {
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
  title?: string;
}

/** @/components/ui/card — Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter */
export type CardProps = React.ComponentProps<"section">;

/** @/components/ui/input, @/components/ui/select (NativeSelect) */
export type InputProps = React.ComponentProps<"input">;
export type NativeSelectProps = React.ComponentProps<"select">;

/** @/components/creatorco/form-field */
export interface FieldA11y {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  "aria-required"?: true;
}
export interface FormFieldProps {
  id: string;
  label: string;
  description?: React.ReactNode;
  errors?: string[];
  required?: boolean;
  optionalLabel?: boolean;
  className?: string;
  children: (a11y: FieldA11y) => React.ReactNode;
}
export interface ChoiceFieldsetProps {
  id: string;
  legend: string;
  description?: React.ReactNode;
  errors?: string[];
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** @/components/creatorco/choices — RadioRow, CheckboxRow, CheckboxChip */
export interface ChoicesProps extends Omit<React.ComponentProps<"input">, "type"> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

/** @/components/creatorco/heading — Eyebrow, DisplayHeading, PageHeading, SectionHeading, Lede */
export type HeadingsProps = React.ComponentProps<"h1">;

/** @/components/creatorco/metric-block */
export interface MetricBlockProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}

/** @/components/creatorco/progress — ProgressSteps, ProgressMeter */
export interface ProgressProps {
  steps: readonly { key: string; label: string }[];
  currentKey: string;
  className?: string;
}
export interface ProgressMeterProps {
  value: number;
  label: string;
  className?: string;
}

/** @/components/creatorco/password-checklist */
export interface RequirementChecklistProps {
  id: string;
  items: { key: string; label: string; met: boolean }[];
  className?: string;
}

/** @/components/creatorco/empty-state */
export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** @/components/ui/skeleton */
export type SkeletonProps = React.ComponentProps<"div">;

/** @/components/creatorco/wordmark */
export interface WordmarkProps {
  className?: string;
  href?: string;
}

/** @/components/creatorco/shells — PageShell (AuthShell, OnboardingShell alongside) */
export interface PageShellProps {
  nav?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  homeHref?: string;
}
export interface AuthShellProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}
export interface OnboardingShellProps {
  progress?: React.ReactNode;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}
