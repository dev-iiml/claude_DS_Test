import type { FeatureKey } from "./engine";

/**
 * Plain-language labels for Professional Graph features (pure; safe on the
 * client and in native apps). Copy describes the creator business — never
 * creditworthiness.
 */
export const FEATURE_COPY: Record<
  FeatureKey,
  { label: string; explain: string; group: "career" | "audience" | "consistency" | "authenticity" | "brand_work" }
> = {
  professional_longevity_months: {
    label: "Creating for",
    explain: "How long you've been creating professionally.",
    group: "career",
  },
  connected_platforms: {
    label: "Connected platforms",
    explain: "Accounts verified through a connection.",
    group: "career",
  },
  total_audience: {
    label: "Combined audience",
    explain: "Followers and subscribers across connected platforms.",
    group: "audience",
  },
  platform_concentration: {
    label: "Platform mix",
    explain: "How spread your audience is across platforms.",
    group: "audience",
  },
  audience_growth_6m: {
    label: "6-month growth",
    explain: "Change in combined audience over six months.",
    group: "audience",
  },
  growth_stability: {
    label: "Growth steadiness",
    explain: "How even your month-to-month growth is.",
    group: "consistency",
  },
  engagement_rate_3m: {
    label: "Engagement",
    explain: "Average engagement over the last three months.",
    group: "audience",
  },
  engagement_stability: {
    label: "Engagement steadiness",
    explain: "How consistent engagement is month to month.",
    group: "consistency",
  },
  posting_consistency_12m: {
    label: "Posting consistency",
    explain: "Months in the last year with new posts.",
    group: "consistency",
  },
  declared_not_connected: {
    label: "Platforms not yet connected",
    explain: "Platforms you told us about that aren't verified yet.",
    group: "authenticity",
  },
  handle_mismatches: {
    label: "Handle differences",
    explain: "Connected handles that differ from what you declared.",
    group: "authenticity",
  },
  follower_spike_detected: {
    label: "Unusual follower jumps",
    explain: "Any month where followers jumped more than 50%.",
    group: "authenticity",
  },
  verified_brand_count: {
    label: "Brands worked with",
    explain: "Different brands with verified collaborations.",
    group: "brand_work",
  },
  verified_collaborations_12m: {
    label: "Collaborations, last 12 months",
    explain: "Verified brand collaborations in the past year.",
    group: "brand_work",
  },
  repeat_brand_count: {
    label: "Repeat brands",
    explain: "Brands you've worked with more than once.",
    group: "brand_work",
  },
  brand_recurrence_rate: {
    label: "Brands that come back",
    explain: "Share of your brands with more than one collaboration.",
    group: "brand_work",
  },
  brand_tenure_months: {
    label: "Brand work span",
    explain: "From your first to your latest verified collaboration.",
    group: "brand_work",
  },
  brand_industry_count: { label: "Industries", explain: "Different industries you've worked in.", group: "brand_work" },
  brand_industry_concentration: {
    label: "Industry mix",
    explain: "How spread your collaborations are across industries.",
    group: "brand_work",
  },
  top_brand_revenue_share_12m: {
    label: "Largest client's share",
    explain: "Your biggest brand's share of verified invoice value this year.",
    group: "brand_work",
  },
  highest_verified_deal: {
    label: "Largest verified deal",
    explain: "Your largest single verified invoice.",
    group: "brand_work",
  },
  median_verified_deal_12m: {
    label: "Typical deal, last 12 months",
    explain: "The middle value of your verified invoices this year.",
    group: "brand_work",
  },
  verified_brand_billings_12m: {
    label: "Verified brand invoices, 12 months",
    explain: "Total of verified invoices this year. Not bank-verified income.",
    group: "brand_work",
  },
  deal_value_growth_12m: {
    label: "Deal value growth",
    explain: "This year's verified invoice value against last year's.",
    group: "brand_work",
  },
  agency_mediated_share: {
    label: "Through agencies or platforms",
    explain: "Share of collaborations billed through an agency or platform.",
    group: "brand_work",
  },
  payment_confirmation_rate: {
    label: "Payments confirmed",
    explain: "Share of verified collaborations with a confirmed payment.",
    group: "brand_work",
  },
};

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export function formatFeatureValue(key: FeatureKey, value: number | boolean | null): string {
  if (value === null) return "Not enough data yet";
  if (typeof value === "boolean") return value ? "Detected" : "None";
  switch (key) {
    case "professional_longevity_months": {
      const y = Math.floor(value / 12);
      const m = value % 12;
      if (y === 0) return `${m} month${m === 1 ? "" : "s"}`;
      return m ? `${y} yr ${m} mo` : `${y} year${y === 1 ? "" : "s"}`;
    }
    case "total_audience":
      return compact.format(value);
    case "audience_growth_6m":
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    case "engagement_rate_3m":
      return `${(value * 100).toFixed(1)}%`;
    case "platform_concentration":
      return value >= 0.75 ? "Concentrated" : value >= 0.45 ? "Balanced" : "Diversified";
    case "growth_stability":
    case "engagement_stability":
      return value >= 0.75 ? "Very steady" : value >= 0.5 ? "Steady" : value >= 0.25 ? "Variable" : "Volatile";
    case "posting_consistency_12m":
      return `${Math.round(value * 100)}% of months`;
    case "highest_verified_deal":
    case "median_verified_deal_12m":
    case "verified_brand_billings_12m":
      return rupees.format(value);
    case "brand_tenure_months": {
      const y = Math.floor(value / 12);
      const m = value % 12;
      if (y === 0) return `${m} month${m === 1 ? "" : "s"}`;
      return m ? `${y} yr ${m} mo` : `${y} year${y === 1 ? "" : "s"}`;
    }
    case "brand_recurrence_rate":
    case "top_brand_revenue_share_12m":
    case "agency_mediated_share":
    case "payment_confirmation_rate":
      return `${Math.round(value * 100)}%`;
    case "brand_industry_concentration":
      return value >= 0.75 ? "Concentrated" : value >= 0.45 ? "Balanced" : "Diversified";
    case "deal_value_growth_12m":
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    default:
      return String(value);
  }
}
