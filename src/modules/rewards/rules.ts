/**
 * Creator Points rules (Stage 14) — pure.
 *
 * Creator Points are a simulated membership currency for requesting Access:
 * not cash, not transferable, not withdrawable, not denominated in rupees, no
 * P2P transfer (CLAUDE.md §18). They are earned for membership milestones and
 * for reaching a Creator Status tier — never for anything credit-related
 * (eligibility checks, offers, borrowing) and never for giving a consent or
 * sharing data, so no one is nudged into either.
 *
 * Any change to an amount or a rule bumps POINTS_RULES_VERSION; each earned
 * entry records the version it was granted under.
 */
export const POINTS_RULES_VERSION = "pts-0.1.0";

export const EARN_RULES = {
  welcome: { points: 500, label: "Welcome to CreatorCo" },
  mobile_verified: { points: 100, label: "Verified your mobile number" },
  tier_onyx: { points: 1_000, label: "Reached Onyx" },
  tier_icon: { points: 2_500, label: "Reached Icon" },
} as const;
export type EarnRule = keyof typeof EARN_RULES;
export const EARN_RULE_CODES = Object.keys(EARN_RULES) as EarnRule[];

/** Each rule is earned at most once per creator: the rule code is the idempotency key. */
export function earnKeyFor(rule: EarnRule): string {
  return rule;
}

/** Ledger entry types: earn (+), hold (−, a pending request), release (+, the hold returned). */
export const LEDGER_ENTRY_TYPES = ["earn", "hold", "release"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** "1,500 points" — never a rupee symbol. */
export function formatPoints(n: number): string {
  return `${new Intl.NumberFormat("en-IN").format(n)} ${Math.abs(n) === 1 ? "point" : "points"}`;
}

export const POINTS_TERMS = [
  "Creator Points have no cash value and aren't money.",
  "They can't be transferred, sold, exchanged or withdrawn.",
  "They're earned for membership milestones and Creator Status — never for borrowing.",
] as const;
