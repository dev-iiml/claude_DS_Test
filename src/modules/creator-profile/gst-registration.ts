import type { Database } from "@/db/create-db";
import { creatorGstRegistrations } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { callProvider, countRecentProviderCalls } from "@/modules/audit";
import {
  getIdentityPrefill,
  maskedPanFromGstin,
  withTransientPan,
  type IdentityPrefillError,
} from "@/modules/identity/identity-prefill";
import type { IdentityLookupProvider } from "@/providers/identity/lookup-types";
import type { GstRegistrationRecord, TaxRegistrationProvider } from "@/providers/tax-registration/types";

import type { GstRegistrationSource, LegalForm } from "./domain";
import { isValidGstin, normaliseGstin } from "./gstin";
import { isPilotSupportedLegalForm } from "./rules";

/**
 * GST registration lookup and verification against the registry, through a
 * TaxRegistrationProvider. Registry data informs the creator's declaration —
 * it never silently changes it, and CreatorCo makes no tax determination.
 */
export const GSTIN_VERIFICATIONS_PER_HOUR = 30;

/** Maps the registry's "constitution of business" to our legal-form vocabulary. */
export function constitutionToLegalForm(constitution: string | null): LegalForm | null {
  if (!constitution) return null;
  const c = constitution.toLowerCase();
  if (c.includes("proprietor")) return "sole_proprietorship";
  if (c.includes("limited liability partnership") || /\bllp\b/.test(c)) return "llp";
  if (c.includes("one person")) return "one_person_company";
  if (c.includes("private limited") || c.includes("public limited") || c.includes("company")) return "private_limited";
  if (c.includes("partnership")) return "partnership";
  return "other_entity";
}

export interface GstRegistrationView extends GstRegistrationRecord {
  suggestedLegalForm: LegalForm | null;
  pilotSupported: boolean;
}

function toView(r: GstRegistrationRecord): GstRegistrationView {
  const suggestedLegalForm = constitutionToLegalForm(r.constitution);
  return {
    ...r,
    suggestedLegalForm,
    pilotSupported: suggestedLegalForm ? isPilotSupportedLegalForm(suggestedLegalForm) : true,
  };
}

export interface GstDeps {
  db: Database;
  identityLookup: IdentityLookupProvider;
  taxRegistry: TaxRegistrationProvider;
  now?: () => Date;
}

/** GST registrations linked to the creator's PAN (PAN used in-request only, never stored). */
export async function findGstRegistrationsForUser(
  deps: GstDeps,
  userId: string,
): Promise<{ ok: true; registrations: GstRegistrationView[] } | { ok: false; reason: IdentityPrefillError }> {
  const result = await withTransientPan(deps, userId, (pan) =>
    callProvider(
      deps.db,
      { userId, provider: deps.taxRegistry.descriptor, operation: "find_gst_by_pan" },
      () => deps.taxRegistry.findRegistrationsByPan({ pan }),
      (r) => ({ outcome: r.registrations.length ? "success" : "not_found", reference: r.reference }),
    ),
  );
  if (!result.ok) return result;
  // Active registrations first.
  const order = { active: 0, suspended: 1, cancelled: 2 } as const;
  const registrations = result.value.registrations.map(toView).sort((a, b) => order[a.status] - order[b.status]);
  return { ok: true, registrations };
}

export type VerifyGstinResult =
  | { ok: true; registration: GstRegistrationView | null; reference: string }
  | { ok: false; reason: "invalid_format" | "too_many" };

export async function verifyGstinForUser(
  deps: Pick<GstDeps, "db" | "taxRegistry" | "now">,
  input: { userId: string; gstin: string },
): Promise<VerifyGstinResult> {
  const gstin = normaliseGstin(input.gstin);
  if (!isValidGstin(gstin)) return { ok: false, reason: "invalid_format" };
  const since = new Date((deps.now?.() ?? new Date()).getTime() - 3_600_000);
  if (
    (await countRecentProviderCalls(deps.db, { userId: input.userId, operation: "verify_gstin", since })) >=
    GSTIN_VERIFICATIONS_PER_HOUR
  ) {
    return { ok: false, reason: "too_many" };
  }
  const r = await callProvider(
    deps.db,
    { userId: input.userId, provider: deps.taxRegistry.descriptor, operation: "verify_gstin" },
    () => deps.taxRegistry.verifyGstin({ gstin }),
    (res) => ({ outcome: res.registration ? "success" : "not_found", reference: res.reference }),
  );
  return { ok: true, registration: r.registration ? toView(r.registration) : null, reference: r.reference };
}

/**
 * Provenance: a GSTIN counts as "found via PAN lookup" when its embedded PAN
 * matches the masked PAN from the creator's own identity lookup.
 */
export async function gstinSourceFor(db: DbExecutor, userId: string, gstin: string): Promise<GstRegistrationSource> {
  const prefill = await getIdentityPrefill(db, userId);
  return prefill && prefill.panMasked === maskedPanFromGstin(gstin) ? "lookup_by_pan" : "manual_entry";
}

export async function storeGstRegistration(
  db: DbExecutor,
  input: {
    creatorId: string;
    registration: GstRegistrationRecord;
    source: GstRegistrationSource;
    provider: string;
    reference: string;
    now: Date;
  },
) {
  const r = input.registration;
  const values = {
    registrationStatus: r.status,
    legalName: r.legalName,
    tradeName: r.tradeName,
    constitution: r.constitution,
    stateCode: r.stateCode,
    registeredOn: r.registeredOn,
    source: input.source,
    provider: input.provider,
    providerReference: input.reference,
    verifiedAt: input.now,
  };
  await db
    .insert(creatorGstRegistrations)
    .values({ creatorId: input.creatorId, gstin: r.gstin, ...values })
    .onConflictDoUpdate({
      target: [creatorGstRegistrations.creatorId, creatorGstRegistrations.gstin],
      set: values,
    });
}
