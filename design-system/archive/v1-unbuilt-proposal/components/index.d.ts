// CreatorCo v1 — component props (specification; implement with shadcn/ui + Tailwind v4).
import type * as React from "react";

export type Tier = "member" | "onyx" | "icon";
export type Tone = "neutral" | "outline" | "success" | "warning" | "danger" | "info" | "brass" | "rani";

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "ghost" | "signature" | "destructive" | "destructive-quiet" | "link";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  loadingLabel?: string; // default "Saving…"
  asChild?: boolean;
}
export interface LinkProps extends React.ComponentProps<"a"> { arrow?: boolean; external?: boolean; }

export interface TextInputProps extends React.ComponentProps<"input"> {
  label: string; help?: React.ReactNode; error?: string; success?: string;
  prefix?: "₹" | "+91" | React.ReactNode; optional?: boolean;
}
export interface SelectProps extends React.ComponentProps<"select"> { label: string; help?: React.ReactNode; error?: string; }
export interface OTPInputProps { length?: 6; value: string; onChange(v: string): void; state?: "idle" | "error" | "verified"; resendIn?: number; }
export interface ToggleProps { checked: boolean; onCheckedChange(v: boolean): void; label: string; disabled?: boolean; }
export interface CheckboxRadioProps extends React.ComponentProps<"input"> { label: string; description?: string; asOption?: boolean; }
export interface FormValidationProps { errors: { field: string; label: string; message: string }[]; savedAt?: Date; }

export interface ContentCardProps { title?: string; action?: React.ReactNode; footerLink?: { label: string; href: string }; children: React.ReactNode; }
export interface StatCardProps { label: string; value: string; delta?: { text: string; direction: "up" | "down"; good: boolean }; spark?: number[]; meter?: number; hint?: string; }
export interface AccessCardProps { title: string; kind: "Brand drop" | "Event" | "Experience"; date: string; city?: string; places?: number; image?: string; minTier?: Tier; state?: "open" | "requested" | "waitlist" | "confirmed"; }

/** STATUS — never accepts money props. */
export interface CreatorStatusProps { tier: Tier; variant?: "badge" | "card"; }
export interface MembershipCardProps { tier: Tier; name: string; memberNo: string; since?: string; tilt?: boolean; }

/** FINANCE — never accepts a tier prop. */
export interface EligibilityResultProps {
  min: number; max: number; product?: string; basis: string;
  factors: { label: string; score: number }[];
  partnerName: string; // rendered in "Subject to partner-lender approval… decided by {partnerName}"
}
export interface CoBrandCardProps { finish: "graphite" | "chalk"; last4: string; issuer: string; network?: React.ReactNode; }
export interface ScoreBreakdownProps { components: { label: string; traditional: number | null; creatorEnhanced: number }[]; modelVersion: string; }

export interface PassportHeaderProps { name: string; handle: string; city: string; verified: boolean; tier: Tier; categories: string[]; bio?: string; avatar?: string; }
export interface PassportSectionsProps { identity: Record<string, string>; history: { title: string; period: string; current?: boolean }[]; brands: { name: string; category: string; since: string; repeat?: boolean }[]; }
export interface ConnectedAccountChipProps { platform: string; handle: string; glyph: "camera" | "video" | "mic" | "link"; state: "connected" | "declared" | "reconnect" | "syncing"; }

export interface ConsentCardProps {
  purpose: string; why: string; uses: string[]; wont?: string; version: string; publishedAt: string;
  required?: boolean; state: "pending" | "given" | "withdrawn"; lang?: "en" | "hi";
  onAgree?(): void; onDecline?(): void; onWithdraw?(): void; receiptHref?: string;
}
export interface ConsentReceiptProps { purpose: string; version: string; givenAt: string; channel: string; reference: string; status: "Active" | "Withdrawn"; }

export interface DataTableProps<T> { columns: { key: keyof T; header: string; align?: "left" | "right"; mono?: boolean }[]; rows: T[]; filters?: { label: string; count?: number; active?: boolean }[]; page: number; pageCount: number; selectedId?: string; }
export interface TabsProps { items: { label: string; count?: number; href: string }[]; active: string; }

export interface AlertProps { tone: "info" | "success" | "warning" | "danger" | "neutral"; title: string; children?: React.ReactNode; dismissible?: boolean; }
export interface ToastProps { message: string; tone?: "neutral" | "success"; action?: { label: string; onClick(): void }; }
export interface EmptyStateProps { title: string; description?: string; action?: React.ReactNode; }
export interface SkeletonProps extends React.ComponentProps<"div"> {}
export interface ErrorStateProps { title: string; description: string; reference?: string; onRetry?(): void; }

export interface TopBarProps { mode: "home" | "flow"; title?: string; step?: string; onBack?(): void; }
export interface BottomNavProps { active: "home" | "passport" | "access" | "money" | "me"; }
export interface SidebarProps { items: { label: string; href: string; icon: string; count?: number }[]; groups?: string[]; active: string; collapsed?: boolean; }
export interface DialogProps { title: string; description: string; confirmLabel: string; cancelLabel: string; destructive?: boolean; }
export interface SheetProps { side: "bottom" | "right"; title: string; children: React.ReactNode; }
export interface ChartsProps { kind: "sparkline" | "line" | "bar"; series: { name: string; values: number[] }[]; labels: string[]; unit?: "inr" | "count" | "pct"; }
export interface WordmarkProps { size?: "sm" | "md" | "lg"; tone?: "default" | "inverse"; }
