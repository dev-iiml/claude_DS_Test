import type { Provider } from "../types";

/**
 * Company lookup (bought, not built; Stage 19). Resolves a public MCA
 * identifier (CIN or LLPIN) to the registry's legal name, status and
 * incorporation date. Public registry data only — never a GSTIN or PAN.
 * Adapters throw `ProviderError("rejected" | "unavailable" | "timeout")`.
 */
export interface CompanyRecord {
  found: boolean;
  legalName: string | null;
  /** Registry status, normalised. */
  status: "active" | "struck_off" | "under_liquidation" | "dormant" | "unknown";
  incorporatedOn: string | null; // YYYY-MM-DD
}

export interface BusinessVerificationProvider extends Provider {
  lookupCompany(input: { identifierType: "cin" | "llpin"; identifier: string }): Promise<CompanyRecord>;
}
