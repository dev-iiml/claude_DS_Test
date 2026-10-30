import type { CreatorAvailability, CreatorOpportunityView } from "@/modules/access";
import { tierLockLabel } from "@/modules/access/presentation";
import { formatPoints } from "@/modules/rewards/rules";

/** Display helpers for the creator's Access pages. */

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const fullDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export function costLabel(points: number): string {
  return points === 0 ? "No points needed" : formatPoints(points);
}

export function availabilityBadge(o: CreatorOpportunityView): { label: string; tone: Tone } {
  const labels: Record<CreatorAvailability, { label: string; tone: Tone }> = {
    open: { label: "Open", tone: "success" },
    requested: { label: "Requested", tone: "info" },
    approved: { label: "Approved", tone: "success" },
    tier_locked: { label: tierLockLabel(o.minTier), tone: "neutral" },
    insufficient_points: { label: `Needs ${formatPoints(o.pointsCost)}`, tone: "neutral" },
    full: { label: "Full", tone: "neutral" },
    not_open_yet: { label: `Opens ${dayMonth.format(o.opensAt)}`, tone: "neutral" },
    closed: { label: "Closed", tone: "neutral" },
  };
  return labels[o.availability];
}
