import { ProviderError } from "../errors";
import { stableHash, type ProviderHealth } from "../types";
import type { BusinessVerificationProvider, CompanyRecord } from "./types";

/**
 * Deterministic mock registry. Fictional data only:
 * - identifiers ending in 000000 (CIN) or 0000 (LLPIN) are "not found";
 * - CINs starting with "U99" are struck off;
 * - otherwise the company is active, named from the identifier unless a
 *   `knownNames` override is configured for demos.
 */
export class MockBusinessVerificationProvider implements BusinessVerificationProvider {
  readonly descriptor = { key: "mock", kind: "business_verification", mode: "mock" } as const;

  constructor(private readonly opts: { simulateOutage?: boolean; knownNames?: Record<string, string> } = {}) {}

  async health(): Promise<ProviderHealth> {
    return { status: this.opts.simulateOutage ? "down" : "ok", checkedAt: new Date(0) };
  }

  async lookupCompany(input: { identifierType: "cin" | "llpin"; identifier: string }): Promise<CompanyRecord> {
    if (this.opts.simulateOutage) throw new ProviderError("unavailable", "mock outage");
    const id = input.identifier.toUpperCase();
    if (/0000$/.test(id) && (input.identifierType === "llpin" || /000000$/.test(id)))
      return { found: false, legalName: null, status: "unknown", incorporatedOn: null };
    const h = stableHash(id);
    const year = input.identifierType === "cin" ? Number(id.slice(8, 12)) : 2010 + (h % 14);
    const name =
      this.opts.knownNames?.[id] ??
      `Fictional Company ${id.slice(-4)} ${input.identifierType === "cin" ? "Private Limited" : "LLP"}`;
    return {
      found: true,
      legalName: name,
      status: id.startsWith("U99") ? "struck_off" : "active",
      incorporatedOn: `${Number.isFinite(year) && year > 1900 ? year : 2015}-${String((h % 12) + 1).padStart(2, "0")}-15`,
    };
  }
}
