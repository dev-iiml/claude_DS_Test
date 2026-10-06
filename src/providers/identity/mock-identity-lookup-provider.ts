import { stableHash, type ProviderHealth } from "../types";
import type { IdentityLookupProvider, IdentityLookupResult } from "./lookup-types";

const FIRST = ["Aanya", "Rohan", "Ishaan", "Meera", "Kavya", "Arjun", "Tara", "Vikram", "Nisha", "Aditya"];
const LAST = ["Sharma", "Iyer", "Reddy", "Kapoor", "Nair", "Banerjee", "Patel", "Menon", "Gill", "Rao"];
const LETTERS = "ABCDEFGHJKLMNPRSTUVW";

/**
 * Deterministic mock. Behaviour is driven by the mobile number's LAST DIGIT so
 * demos are predictable:
 *   0     → not found
 *   1–9   → found (fictional name). The PAN's 4 digits are the mobile's last 4
 *           digits, which drives the mock GST lookup (see MockTaxRegistrationProvider).
 *
 * Generated PANs use 'Z' as the 4th (holder-type) character, which no real PAN
 * uses, so mock values can never collide with a real person.
 */
export class MockIdentityLookupProvider implements IdentityLookupProvider {
  readonly descriptor = { key: "mock", kind: "identity_lookup", mode: "mock" } as const;

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  async lookupByMobile(input: { mobile: string; consentReceiptId: string }): Promise<IdentityLookupResult> {
    const digits = input.mobile.replace(/\D/g, "");
    const h = stableHash(digits);
    const reference = `idl_${h.toString(36)}`;
    if (digits.endsWith("0")) return { status: "not_found", reference };

    const first = FIRST[h % FIRST.length] ?? "Aanya";
    const last = LAST[(h >>> 4) % LAST.length] ?? "Sharma";
    const l = (n: number) => LETTERS[(h >>> n) % LETTERS.length] ?? "A";
    const pan = `${l(1)}${l(6)}${l(11)}Z${last[0]?.toUpperCase() ?? "A"}${digits.slice(-4)}${l(16)}`;
    return { status: "found", fullName: `${first} ${last}`, pan, reference };
  }
}
