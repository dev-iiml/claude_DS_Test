import type { Provider } from "../types";

/**
 * "Mobile number → identity" lookup (e.g. a PAN-linked name search offered by
 * KYC vendors). Must only be called for an OTP-verified mobile and with the
 * creator's `identity_prefill` consent.
 *
 * The full PAN is returned for in-request use only (e.g. a GST lookup). Callers
 * must not persist, log or forward it; persist `maskPan(pan)` at most.
 */
export type IdentityLookupResult =
  { status: "found"; fullName: string; pan: string; reference: string } | { status: "not_found"; reference: string };

export interface IdentityLookupProvider extends Provider {
  lookupByMobile(input: { mobile: string; consentReceiptId: string }): Promise<IdentityLookupResult>;
}
