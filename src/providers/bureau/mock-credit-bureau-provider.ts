import { ProviderError } from "../errors";
import { stableHash, type ProviderHealth } from "../types";
import type { BureauSummary, CreditBureauProvider } from "./types";

/**
 * Deterministic mock bureau. The four digits of the PAN drive the result so
 * demos are predictable (`ABCPE1234F` → digits 1,2,3,4):
 * - last digit: 0 no history · 1–2 thin · 3–4 low · 5–7 medium · 8–9 high
 * - third digit 9: one delinquent account in the last 12 months
 * - second digit: enquiries in the last 6 months (mod 4)
 */
export class MockCreditBureauProvider implements CreditBureauProvider {
  readonly descriptor = { key: "mock", kind: "bureau", mode: "mock" } as const;

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  async fetchSummary(input: { subjectRef: string; consentReceiptId: string }): Promise<BureauSummary> {
    const digits = input.subjectRef.slice(5, 9);
    if (!/^[0-9]{4}$/.test(digits)) throw new ProviderError("rejected", "mock bureau expects a PAN");
    const [d1, d2, d3, d4] = [...digits].map(Number) as [number, number, number, number];
    const scoreBand = d4 === 0 ? "no_hit" : d4 <= 2 ? "thin" : d4 <= 4 ? "low" : d4 <= 7 ? "medium" : "high";
    return {
      reference: `bur_${stableHash(`${input.subjectRef}:${input.consentReceiptId}`).toString(36)}`,
      scoreBand,
      activeTradelines: scoreBand === "no_hit" ? 0 : (d1 % 5) + 1,
      delinquentTradelines12m: scoreBand !== "no_hit" && d3 === 9 ? 1 : 0,
      enquiries6m: d2 % 4,
      retrievedAt: new Date(),
    };
  }
}
