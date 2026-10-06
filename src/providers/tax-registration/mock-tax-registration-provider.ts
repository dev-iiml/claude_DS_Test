import { stableHash, type ProviderHealth } from "../types";
import type { GstRegistrationRecord, TaxRegistrationProvider } from "./types";

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function checkChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARSET.indexOf(first14[i] ?? "0") * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36] ?? "0";
}

function gstin(stateCode: string, pan: string, entity: string) {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + checkChar(first14);
}

function record(g: string, status: GstRegistrationRecord["status"], constitution: string, trade: string | null) {
  return {
    gstin: g,
    status,
    legalName: "Registered Proprietor (mock)",
    tradeName: trade,
    constitution,
    stateCode: g.slice(0, 2),
    registeredOn: "2021-04-01",
  } satisfies GstRegistrationRecord;
}

/**
 * Deterministic mock. For PAN lookups the LAST DIGIT of the PAN's 4-digit
 * block decides the outcome (the mock identity lookup copies the mobile's last
 * 4 digits there, so the mobile number drives the demo):
 *   1–3 → no registrations
 *   4–6 → one active Proprietorship (Maharashtra)
 *   7–8 → an active Proprietorship + a cancelled one (Karnataka)
 *   9   → one active Private Limited Company (not supported in the pilot)
 *
 * For a typed GSTIN, the entity character (13th) decides: '9' → cancelled,
 * '8' → suspended, otherwise active Proprietorship.
 */
export class MockTaxRegistrationProvider implements TaxRegistrationProvider {
  readonly descriptor = { key: "mock", kind: "tax_registration", mode: "mock" } as const;

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  async findRegistrationsByPan(input: { pan: string }) {
    const reference = `gsl_${stableHash(input.pan).toString(36)}`;
    const d = Number(input.pan.slice(8, 9));
    if (Number.isNaN(d) || d <= 3) return { registrations: [], reference };
    if (d <= 6)
      return {
        registrations: [record(gstin("27", input.pan, "1"), "active", "Proprietorship", "Studio Mock")],
        reference,
      };
    if (d <= 8) {
      return {
        registrations: [
          record(gstin("27", input.pan, "1"), "active", "Proprietorship", "Studio Mock"),
          record(gstin("29", input.pan, "9"), "cancelled", "Proprietorship", null),
        ],
        reference,
      };
    }
    return {
      registrations: [record(gstin("27", input.pan, "1"), "active", "Private Limited Company", "Mock Media Pvt Ltd")],
      reference,
    };
  }

  async verifyGstin(input: { gstin: string }) {
    const reference = `gsv_${stableHash(input.gstin).toString(36)}`;
    const g = input.gstin;
    const pan = g.slice(2, 12);
    if (pan[3] === "Z") {
      const { registrations } = await this.findRegistrationsByPan({ pan });
      return { registration: registrations.find((r) => r.gstin === g) ?? null, reference };
    }
    const entity = g[12];
    const status = entity === "9" ? "cancelled" : entity === "8" ? "suspended" : "active";
    return {
      registration: { ...record(g, status, "Proprietorship", null), legalName: "Registrant (mock)" },
      reference,
    };
  }
}
