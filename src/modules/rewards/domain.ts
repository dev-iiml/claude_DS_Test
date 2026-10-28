import type { CreatorStatusTier } from "@/modules/creator-status/status";

/**
 * Creator Points — pure vocabulary and rules (Stage 14, `pts-0.1.0`).
 *
 * Points are a simulation: not cash, not transferable, not withdrawable, not
 * denominated in rupees, no P2P (CLAUDE.md §18). They are never shown as
 * money and never earned through anything credit-related.
 *
 * The ledger is append-only. `earn` and `release` add points, `hold` takes
 * them; the balance is the sum. A hold for an approved request is never
 * released — those points are spent.
 */
export const POINTS_RULES_VERSION = "pts-0.1.0";

export const POINTS_ENTRY_TYPES = ["earn", "hold", "release"] as const;
export type PointsEntryType = (typeof POINTS_ENTRY_TYPES)[number];

/** One-off milestones. Each is granted at most once per creator and never clawed back. */
export const POINTS_MILESTONES = ["welcome", "verified_mobile", "tier_onyx", "tier_icon"] as const;
export type PointsMilestone = (typeof POINTS_MILESTONES)[number];

export const MILESTONE_POINTS: Record<PointsMilestone, number> = {
  welcome: 500,
  verified_mobile: 100,
  tier_onyx: 1_000,
  tier_icon: 2_500,
};

export const MILESTONE_LABELS: Record<PointsMilestone, string> = {
  welcome: "Welcome to CreatorCo",
  verified_mobile: "Verified your mobile number",
  tier_onyx: "Reached Onyx",
  tier_icon: "Reached Icon",
};

export interface MilestoneFacts {
  profileCompleted: boolean;
  mobileVerified: boolean;
  tier: CreatorStatusTier;
}

/**
 * Milestones the creator qualifies for and hasn't been granted yet. Reaching
 * Icon also grants Onyx if it was skipped. Dropping a tier later takes nothing back.
 */
export function milestonesDue(facts: MilestoneFacts, earned: ReadonlySet<PointsMilestone>): PointsMilestone[] {
  const due: PointsMilestone[] = [];
  if (facts.profileCompleted) due.push("welcome");
  if (facts.mobileVerified) due.push("verified_mobile");
  if (facts.tier === "onyx" || facts.tier === "icon") due.push("tier_onyx");
  if (facts.tier === "icon") due.push("tier_icon");
  return due.filter((m) => !earned.has(m));
}

export interface LedgerEntryLike {
  entryType: PointsEntryType;
  amount: number;
}

/** Signed amount rule the database also enforces: earn and release are positive, hold is negative. */
export function isValidEntry(entry: LedgerEntryLike): boolean {
  if (!Number.isSafeInteger(entry.amount) || entry.amount === 0) return false;
  return entry.entryType === "hold" ? entry.amount < 0 : entry.amount > 0;
}

export function pointsBalance(entries: readonly LedgerEntryLike[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

/** Formats a points figure. Never a currency symbol or rupee value. */
export function formatPoints(points: number): string {
  return `${new Intl.NumberFormat("en-IN").format(points)} ${Math.abs(points) === 1 ? "point" : "points"}`;
}
