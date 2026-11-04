/**
 * Shared provider contracts. Core business logic depends on these interfaces,
 * never on vendor SDKs. Vendor adapters live beside the mocks in each folder.
 */
export const PROVIDER_KINDS = [
  "social",
  "identity",
  "identity_lookup",
  "tax_registration",
  "notification",
  "bureau",
  "financial_data",
  "lender",
  "document_storage",
  "file_scan",
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_MODES = ["mock", "sandbox", "live"] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export interface ProviderDescriptor {
  /** Stable, vendor-neutral key stored in our data (e.g. `mock`, never a raw vendor id). */
  key: string;
  kind: ProviderKind;
  mode: ProviderMode;
}

export interface ProviderHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: Date;
}

export interface Provider {
  readonly descriptor: ProviderDescriptor;
  health(): Promise<ProviderHealth>;
}

/** Deterministic 32-bit hash used by mocks so outputs are reproducible from inputs. */
export function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
