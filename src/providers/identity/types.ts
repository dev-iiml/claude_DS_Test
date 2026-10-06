import type { Provider } from "../types";

/**
 * Identity verification (KYC / V-CIP) is bought, not built. The provider runs
 * a hosted flow and collects documents directly; CreatorCo receives only the
 * outcome and a reference — never PAN/Aadhaar numbers or document images.
 */
export type IdentityVerificationMethod = "pan" | "ckyc" | "digilocker" | "vcip";

export interface IdentityVerificationResult {
  reference: string;
  status: "pending" | "verified" | "failed";
  /** 0–1 similarity between verified name and declared legal name, when available. */
  nameMatchScore: number | null;
  completedAt: Date | null;
}

export interface IdentityVerificationProvider extends Provider {
  startVerification(input: { subjectRef: string; method: IdentityVerificationMethod; declaredName: string }): Promise<{
    reference: string;
    redirectUrl: string;
  }>;
  getVerificationResult(reference: string): Promise<IdentityVerificationResult>;
}
