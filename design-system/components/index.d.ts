/**
 * CreatorCo components — prop types as documentation (mirrors the source; not type-checked).
 * UI primitives: import from "@/components/ui/<name>". Product components: "@/components/creatorco".
 * The preview bundle (bundle.js) exposes only `CreatorCo.mount(specimen)`; use the real imports in code.
 */
import type * as React from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
type CreatorStatusTier = "member" | "onyx" | "icon";

/* ---------- src/components/ui ---------- */

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "ghost" | "link" | "destructive" | "gold";
  /** sm 36px pill · md 50px (h-control) · lg 54px (h-control-lg) · icon 44px circle */
  size?: "sm" | "md" | "lg" | "icon";
  asChild?: boolean;
}
export interface BadgeProps extends React.ComponentProps<"span"> {
  tone?: Tone | "ink";
}
export interface AlertProps extends React.ComponentProps<"div"> {
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
  title?: string;
}
export type CardProps = React.ComponentProps<"section">;
export type InputProps = React.ComponentProps<"input">;
export type NativeSelectProps = React.ComponentProps<"select">;
export type LabelProps = React.ComponentProps<"label">;
export type SeparatorProps = React.ComponentProps<"hr">;
export type SkeletonProps = React.ComponentProps<"div">;

/* ---------- src/components/creatorco ---------- */

export interface StatusBadgeProps {
  tone?: Tone;
  children: React.ReactNode;
}
export interface CreatorStatusBadgeProps {
  tier: CreatorStatusTier;
}
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
  /** default true: shows "Optional" on fields that are not required */
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
export interface FieldErrorProps {
  id?: string;
  errors?: string[];
}
export interface RadioRowProps extends Omit<React.ComponentProps<"input">, "type"> {
  label: React.ReactNode;
  description?: React.ReactNode;
}
export type CheckboxRowProps = RadioRowProps;
export interface CheckboxChipProps extends Omit<React.ComponentProps<"input">, "type"> {
  label: string;
}
export interface SwitchRowProps extends Omit<React.ComponentProps<"input">, "type" | "role"> {
  label: React.ReactNode;
  description?: React.ReactNode;
}
export interface SegmentedControlProps {
  name: string;
  legend: string;
  options: { value: string; label: string }[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}
export interface ProgressStepsProps {
  steps: readonly { key: string; label: string }[];
  currentKey: string;
  className?: string;
}
export interface ProgressMeterProps {
  /** 0–100, clamped */
  value: number;
  label: string;
  className?: string;
}
export interface RequirementChecklistProps {
  id: string;
  items: { key: string; label: string; met: boolean }[];
  className?: string;
}
export interface MetricBlockProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}
export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}
export interface SubmitButtonProps extends ButtonProps {
  /** default "Saving…" */
  pendingLabel?: string;
}
export interface WordmarkProps {
  className?: string;
  /** default "/" */
  href?: string;
}
export interface ListGroupProps {
  id?: string;
  label?: string;
  footer?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}
export interface ListRowProps {
  label: React.ReactNode;
  detail?: React.ReactNode;
  value?: React.ReactNode;
  accessory?: React.ReactNode;
  /** makes the whole row a link with a chevron */
  href?: string;
  leading?: React.ReactNode;
  className?: string;
}
export interface MembershipCardProps {
  displayName: string;
  handle: string | null;
  tier: CreatorStatusTier;
  memberSince: string;
  memberNumber: string;
  className?: string;
}
export interface VerificationMarkProps {
  state: "verified" | "declared" | "attention" | "missing";
  className?: string;
}
export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}
export interface BackLinkProps {
  href: string;
  /** the parent screen's title */
  label: string;
}
export interface ConsentTextProps {
  definition: { id: string; title: string; purpose: string; body: string; version: number };
  id: string;
  className?: string;
}
export interface FormFooterProps {
  children: React.ReactNode;
  className?: string;
}
export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "passport" | "access" | "account" | "console";
}
export interface TabBarProps {
  items: NavItem[];
}
export interface SidebarProps {
  items: NavItem[];
  footer?: React.ReactNode;
}
export interface AppShellProps {
  nav: NavItem[];
  sidebarFooter?: React.ReactNode;
  topBarAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}
export interface OnboardingShellProps {
  progress?: React.ReactNode;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string | null;
  children: React.ReactNode;
}
export interface AuthShellProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}
export interface ComplianceNoteProps {
  className?: string;
}

/** Preview bundle global. */
export declare function mount(specimen: string, el?: HTMLElement | null): void;
export declare const specimens: string[];
