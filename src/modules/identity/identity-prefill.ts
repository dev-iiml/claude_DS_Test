import { eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { identityLookupResults } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { callProvider, countRecentProviderCalls, recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, findValidReceipt, getActiveDefinition, grantConsent } from "@/modules/consent";
import type { IdentityLookupProvider } from "@/providers/identity/lookup-types";

import { getVerifiedMobile } from "./mobile-verification";

/**
 * Consented, OTP-gated identity prefill: verified mobile → provider lookup →
 * legal name to prefill (creator can still edit) + masked PAN.
 *
 * The full PAN never leaves this module: it is masked before storage and only
 * handed to `withTransientPan` callbacks (e.g. the GST lookup) in-request.
 */
export const IDENTITY_LOOKUPS_PER_HOUR = 5;

export function maskPan(pan: string): string {
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error("unexpected PAN format from provider");
  return `XXXXX${pan.slice(5)}`;
}

/** The PAN embedded in a GSTIN, masked the same way (for provenance comparison). */
export function maskedPanFromGstin(gstin: string): string {
  return `XXXXX${gstin.slice(7, 12)}`;
}

export interface IdentityPrefillDeps {
  db: Database;
  identityLookup: IdentityLookupProvider;
  now?: () => Date;
}

export type IdentityPrefillError = "mobile_not_verified" | "consent_required" | "too_many" | "not_found";

export type IdentityPrefillResult =
  { ok: true; fullName: string; panMasked: string } | { ok: false; reason: IdentityPrefillError };

async function lookup(
  deps: IdentityPrefillDeps,
  userId: string,
  mobile: string,
  consentReceiptId: string,
  operation: string,
) {
  return callProvider(
    deps.db,
    { userId, provider: deps.identityLookup.descriptor, operation, consentReceiptId },
    () => deps.identityLookup.lookupByMobile({ mobile, consentReceiptId }),
    (r) => ({ outcome: r.status === "found" ? "success" : "not_found", reference: r.reference }),
  );
}

async function throttled(deps: IdentityPrefillDeps, userId: string) {
  const since = new Date((deps.now?.() ?? new Date()).getTime() - 3_600_000);
  const n = await countRecentProviderCalls(deps.db, { userId, operation: "lookup_by_mobile", since });
  const m = await countRecentProviderCalls(deps.db, { userId, operation: "lookup_by_mobile_for_gst", since });
  return n + m >= IDENTITY_LOOKUPS_PER_HOUR;
}

/** Grants the identity-prefill consent (exact version shown) and fetches the name. */
export async function fetchIdentityPrefill(
  deps: IdentityPrefillDeps,
  input: { userId: string; consentDefinitionId: string },
): Promise<IdentityPrefillResult> {
  const now = deps.now?.() ?? new Date();
  const mobile = await getVerifiedMobile(deps.db, input.userId);
  if (!mobile) return { ok: false, reason: "mobile_not_verified" };
  if (await throttled(deps, input.userId)) return { ok: false, reason: "too_many" };

  const receipt = await grantConsent(deps.db, {
    userId: input.userId,
    key: CONSENT_KEYS.identityPrefill,
    consentDefinitionId: input.consentDefinitionId,
    source: "onboarding",
    metadata: { surface: "onboarding_about" },
    now,
  });

  const result = await lookup(deps, input.userId, mobile, receipt.id, "lookup_by_mobile");
  if (result.status !== "found") return { ok: false, reason: "not_found" };

  const panMasked = maskPan(result.pan);
  const values = {
    mobile,
    verifiedName: result.fullName,
    panMasked,
    provider: deps.identityLookup.descriptor.key,
    providerReference: result.reference,
    consentReceiptId: receipt.id,
    fetchedAt: now,
  };
  await deps.db
    .insert(identityLookupResults)
    .values({ userId: input.userId, ...values })
    .onConflictDoUpdate({ target: identityLookupResults.userId, set: values });

  await recordAuditEvent(deps.db, {
    actorType: "user",
    actorId: input.userId,
    eventType: "identity.prefill_fetched",
    entityType: "user",
    entityId: input.userId,
    metadata: { provider: values.provider },
  });

  return { ok: true, fullName: result.fullName, panMasked };
}

/**
 * Runs `fn` with the creator's full PAN, fetched fresh from the provider and
 * never stored. Requires a verified mobile and a valid identity-prefill consent.
 */
export async function withTransientPan<T>(
  deps: IdentityPrefillDeps,
  userId: string,
  fn: (pan: string) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: IdentityPrefillError }> {
  const mobile = await getVerifiedMobile(deps.db, userId);
  if (!mobile) return { ok: false, reason: "mobile_not_verified" };
  const receipt = await findValidReceipt(deps.db, userId, CONSENT_KEYS.identityPrefill);
  if (!receipt) return { ok: false, reason: "consent_required" };
  if (await throttled(deps, userId)) return { ok: false, reason: "too_many" };

  const result = await lookup(deps, userId, mobile, receipt.id, "lookup_by_mobile_for_gst");
  if (result.status !== "found") return { ok: false, reason: "not_found" };
  return { ok: true, value: await fn(result.pan) };
}

export async function getIdentityPrefill(db: DbExecutor, userId: string) {
  const [row] = await db.select().from(identityLookupResults).where(eq(identityLookupResults.userId, userId)).limit(1);
  return row ?? null;
}

/** The active identity-prefill consent text (for display before the user opts in). */
export async function getIdentityPrefillConsent(db: DbExecutor) {
  return getActiveDefinition(db, CONSENT_KEYS.identityPrefill);
}

export { namesMatch } from "./name-match";
