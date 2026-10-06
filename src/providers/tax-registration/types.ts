import type { Provider } from "../types";

/** A GST registration as reported by the registry (GSTN data via a vendor). */
export interface GstRegistrationRecord {
  gstin: string;
  status: "active" | "suspended" | "cancelled";
  legalName: string | null;
  tradeName: string | null;
  /** "Constitution of business", e.g. "Proprietorship", "Private Limited Company". */
  constitution: string | null;
  stateCode: string;
  registeredOn: string | null; // YYYY-MM-DD
}

export interface TaxRegistrationProvider extends Provider {
  /** All GST registrations linked to a PAN. The PAN is used in-request only. */
  findRegistrationsByPan(input: {
    pan: string;
  }): Promise<{ registrations: GstRegistrationRecord[]; reference: string }>;
  /** Registry status for one GSTIN, or null if the registry has no record. */
  verifyGstin(input: { gstin: string }): Promise<{ registration: GstRegistrationRecord | null; reference: string }>;
}
