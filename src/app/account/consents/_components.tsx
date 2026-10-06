import { StatusBadge } from "@/components/creatorco";
import type { PurposeStatus } from "@/modules/privacy";

import { CreatorShell } from "@/app/_components/creator-shell";
import { PausedShell } from "@/app/paused/paused-shell";

const STATUS = {
  on: { tone: "success", label: "On" },
  off: { tone: "neutral", label: "Off" },
  needs_review: { tone: "warning", label: "Review update" },
  never: { tone: "neutral", label: "Not given" },
} as const;

export function PurposeStatusBadge({ status }: { status: PurposeStatus }) {
  return <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>;
}

/** Member shell normally; a minimal shell while membership is paused. */
export function ConsentFrame({ paused, children }: { paused: boolean; children: React.ReactNode }) {
  return paused ? <PausedShell>{children}</PausedShell> : <CreatorShell>{children}</CreatorShell>;
}

export const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});
