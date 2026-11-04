/**
 * Passport bands (Stage 19) — pure and versioned. Exact figures never leave
 * CreatorCo on a passport: followers, engagement and deal sizes are shown as
 * bands only. Any change to a band bumps PASSPORT_BANDS_VERSION.
 */
export const PASSPORT_BANDS_VERSION = "ppb-0.1.0";

type Band = readonly [lo: number, hi: number, label: string];

const pick = (bands: readonly Band[], v: number) => bands.find(([lo, hi]) => v >= lo && v < hi)?.[2] ?? null;

const FOLLOWER_BANDS: readonly Band[] = [
  [0, 1_000, "Under 1k"],
  [1_000, 10_000, "1k–10k"],
  [10_000, 50_000, "10k–50k"],
  [50_000, 100_000, "50k–100k"],
  [100_000, 500_000, "100k–500k"],
  [500_000, 1_000_000, "500k–1M"],
  [1_000_000, 5_000_000, "1M–5M"],
  [5_000_000, Number.POSITIVE_INFINITY, "5M+"],
];

export function followerBand(count: number | null): string | null {
  return count === null || !Number.isFinite(count) || count < 0 ? null : pick(FOLLOWER_BANDS, count);
}

/** Deal sizes in rupees. */
const DEAL_BANDS: readonly Band[] = [
  [0, 25_000, "<₹25k"],
  [25_000, 50_000, "₹25k–50k"],
  [50_000, 1_00_000, "₹50k–1L"],
  [1_00_000, 2_50_000, "₹1–2.5L"],
  [2_50_000, 5_00_000, "₹2.5–5L"],
  [5_00_000, Number.POSITIVE_INFINITY, "₹5L+"],
];

export function dealBand(rupees: number | null): string | null {
  return rupees === null || !Number.isFinite(rupees) || rupees < 0 ? null : pick(DEAL_BANDS, rupees);
}

/** 12-month verified billings use the same bands, scaled up. */
const BILLINGS_BANDS: readonly Band[] = [
  [0, 1_00_000, "Under ₹1L"],
  [1_00_000, 5_00_000, "₹1–5L"],
  [5_00_000, 10_00_000, "₹5–10L"],
  [10_00_000, 25_00_000, "₹10–25L"],
  [25_00_000, 50_00_000, "₹25–50L"],
  [50_00_000, Number.POSITIVE_INFINITY, "₹50L+"],
];

export function billingsBand(rupees: number | null): string | null {
  return rupees === null || !Number.isFinite(rupees) || rupees < 0 ? null : pick(BILLINGS_BANDS, rupees);
}

/** Band labels, for the Models & rules page. */
export const PASSPORT_BAND_LABELS = {
  followers: FOLLOWER_BANDS.map((b) => b[2]),
  deals: DEAL_BANDS.map((b) => b[2]),
  billings: BILLINGS_BANDS.map((b) => b[2]),
};

/** Year-on-year change in verified deal value (percent). */
export function growthBand(percent: number | null): string | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  if (percent < -10) return "Lower than last year";
  if (percent <= 10) return "About the same as last year";
  if (percent <= 50) return "Up to 1.5× last year";
  return "More than 1.5× last year";
}

/** Share of the largest client in 12-month billings (0–1). */
export function concentrationBand(share: number | null): string | null {
  if (share === null || !Number.isFinite(share)) return null;
  if (share < 0.34) return "No client above a third";
  if (share < 0.67) return "Largest client a third to two-thirds";
  return "Largest client over two-thirds";
}

/** Engagement rate (0–1, e.g. 0.041 = 4.1%). */
export function engagementBand(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate) || rate < 0) return null;
  if (rate < 0.01) return "Under 1%";
  if (rate < 0.03) return "1–3%";
  if (rate < 0.06) return "3–6%";
  return "6%+";
}

/** Growth stability (0–1 from the Professional Graph). */
export function stabilityBand(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  if (v >= 0.7) return "Steady";
  if (v >= 0.4) return "Variable";
  return "Uneven";
}

/** A ratio shown to unlockers as a whole percent (counts and ratios are not money). */
export function percent(v: number | null): string | null {
  return v === null || !Number.isFinite(v) ? null : `${Math.round(v * 100)}%`;
}
