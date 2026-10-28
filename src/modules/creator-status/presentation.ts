import type { CriterionResult, StatusCriterion } from "./rules";

/** Display copy for Creator Status. Pure. */

export const STATUS_CRITERION_LABELS: Record<StatusCriterion, string> = {
  verified_activity: "Verified creator activity",
  longevity: "Professional longevity",
  reach: "Professional reach",
  engagement_quality: "Engagement quality",
  consistency: "Posting consistency",
  engagement_stability: "Steady engagement",
  authenticity: "Audience authenticity",
};

const people = new Intl.NumberFormat("en-IN");
const pct = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, "")}%`;

/** "At least 24 months, verified" — what a criterion asks for at a tier. */
export function criterionRequirement(c: CriterionResult): string {
  switch (c.key) {
    case "verified_activity":
      return c.threshold === 1 ? "At least one connected account" : `Accounts connected on ${c.threshold}+ platforms`;
    case "longevity":
      return `${c.threshold}+ months, verified from connected accounts`;
    case "reach":
      return `${people.format(c.threshold ?? 0)}+ people across connected accounts`;
    case "engagement_quality":
      return `${pct(c.threshold ?? 0)}+ average engagement, last 3 months`;
    case "consistency":
      // Rounded up: the rule is a share (≥ 0.6 needs 8 of 12, not 7).
      return `Posting in ${Math.ceil((c.threshold ?? 0) * 12 - 1e-9)} of the last 12 months`;
    case "engagement_stability":
      return "Engagement that holds steady month to month";
    case "authenticity":
      return "No unusual follower spikes or handle mismatches";
  }
}

/** The creator's own value for a criterion, or why it's missing. */
export function criterionValue(c: CriterionResult): string {
  if (c.state === "missing") return "Not measured yet";
  if (c.value === null) return c.state === "met" ? "Met" : "Not met";
  switch (c.key) {
    case "verified_activity":
      return `${c.value} platform${c.value === 1 ? "" : "s"}`;
    case "longevity":
      return `${c.value} months`;
    case "reach":
      return people.format(c.value);
    case "engagement_quality":
      return pct(c.value);
    case "consistency":
      return `${Math.round(c.value * 12)} of 12 months`;
    case "engagement_stability":
      return `${Math.round(c.value * 100)} / 100`;
    case "authenticity":
      return c.state === "met" ? "Met" : "Not met";
  }
}

export const STATUS_NOT_CREDIT_NOTE =
  "Creator Status reflects your professional standing. It never affects financial eligibility, a recommendation or any limit.";
