/**
 * The ONLY shape that leaves `fin` for a brand payment match (Stage 18):
 * an enum and a month. Enums only — imported by `modules/brand-work`.
 */
export type BrandPaymentMatchResult = "seen" | "not_seen" | "unknown";

export interface BrandPaymentMatchOutcome {
  result: BrandPaymentMatchResult;
  /** First of the month the credit was booked (`YYYY-MM-01`), only when `seen`. */
  month: string | null;
}
