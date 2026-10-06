import type { Provider } from "../types";

/**
 * Credit bureau access happens under the regulated entity's arrangement. The
 * interface returns a derived summary for underwriting — not raw reports or
 * tradelines — and requires a reference to the financial-eligibility consent.
 */
export interface BureauSummary {
  reference: string;
  scoreBand: "no_hit" | "thin" | "low" | "medium" | "high";
  activeTradelines: number;
  delinquentTradelines12m: number;
  enquiries6m: number;
  retrievedAt: Date;
}

export interface CreditBureauProvider extends Provider {
  fetchSummary(input: { subjectRef: string; consentReceiptId: string }): Promise<BureauSummary>;
}
