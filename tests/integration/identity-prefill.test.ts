import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  consentDefinitions,
  consentReceipts,
  creatorGstRegistrations,
  identityLookupResults,
  mobileVerifications,
  providerRequests,
  users,
} from "@/db/schema";
import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import { findGstRegistrationsForUser } from "@/modules/creator-profile/gst-registration";
import { saveAboutStep, saveBusinessStep, saveProfileStep } from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { fetchIdentityPrefill, maskPan } from "@/modules/identity/identity-prefill";
import { requestMobileOtp, verifyMobileOtp } from "@/modules/identity/mobile-verification";
import { MockIdentityLookupProvider } from "@/providers/identity/mock-identity-lookup-provider";
import { MockNotificationProvider } from "@/providers/notification/mock-notification-provider";
import { MockTaxRegistrationProvider } from "@/providers/tax-registration/mock-tax-registration-provider";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const notifications = new MockNotificationProvider();
const identityLookup = new MockIdentityLookupProvider();
const taxRegistry = new MockTaxRegistrationProvider();
const PREFILL_CONSENT = CONSENT_DEFINITION_SEEDS[1].id;

let seq = 0;
/** A unique fictional mobile whose last digit drives the mock providers. */
function mobileEnding(lastDigit: number) {
  seq += 1;
  const middle = String((Date.now() + seq * 7919) % 100_000_000).padStart(8, "0");
  return `9${middle}${lastDigit}`;
}

async function newCreator() {
  const r = await signUpCreator(authDepsFor(db), { email: testEmail("idv"), password: "Strong-pass1" });
  if (!r.ok) throw new Error("signup failed");
  return r.user.userId;
}

async function verifiedCreator(lastDigit: number) {
  const userId = await newCreator();
  const mobile = mobileEnding(lastDigit);
  const sent = await requestMobileOtp({ db, notifications }, { userId, mobile });
  if (!sent.ok) throw new Error(`otp send failed: ${sent.reason}`);
  const v = await verifyMobileOtp({ db, notifications }, { userId, challengeId: sent.challengeId, code: "123456" });
  if (!v.ok) throw new Error(`otp verify failed: ${v.reason}`);
  return { userId, mobile };
}

describe("mobile OTP verification", () => {
  it("verifies ownership and stores only a hash of the code", async () => {
    const userId = await newCreator();
    const mobile = mobileEnding(5);
    expect(await requestMobileOtp({ db, notifications }, { userId, mobile: "12345" })).toEqual({
      ok: false,
      reason: "invalid_mobile",
    });

    const sent = await requestMobileOtp(
      { db, notifications },
      { userId, mobile: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}` },
    );
    expect(sent).toMatchObject({ ok: true, mockCode: "123456" });
    if (!sent.ok) return;

    const [row] = await db.select().from(mobileVerifications).where(eq(mobileVerifications.id, sent.challengeId));
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.codeHash).not.toContain("123456");

    expect(
      await verifyMobileOtp({ db, notifications }, { userId, challengeId: sent.challengeId, code: "000000" }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_code",
      attemptsLeft: 4,
    });
    expect(
      await verifyMobileOtp({ db, notifications }, { userId, challengeId: sent.challengeId, code: "123456" }),
    ).toEqual({
      ok: true,
      mobile: `+91${mobile}`,
    });
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u!.mobile).toBe(`+91${mobile}`);
    expect(u!.mobileVerifiedAt).not.toBeNull();

    // A used challenge can't be replayed.
    expect(
      await verifyMobileOtp({ db, notifications }, { userId, challengeId: sent.challengeId, code: "123456" }),
    ).toMatchObject({
      reason: "not_found",
    });
  });

  it("locks a challenge after five wrong codes and throttles resends", async () => {
    const userId = await newCreator();
    const mobile = mobileEnding(5);
    const sent = await requestMobileOtp({ db, notifications }, { userId, mobile });
    if (!sent.ok) throw new Error("setup");
    for (let i = 0; i < 4; i++)
      await verifyMobileOtp({ db, notifications }, { userId, challengeId: sent.challengeId, code: "111111" });
    expect(
      await verifyMobileOtp({ db, notifications }, { userId, challengeId: sent.challengeId, code: "111111" }),
    ).toMatchObject({
      reason: "locked",
    });
    expect(
      await verifyMobileOtp({ db, notifications }, { userId, challengeId: sent.challengeId, code: "123456" }),
    ).toMatchObject({
      reason: "locked",
    });
    expect(await requestMobileOtp({ db, notifications }, { userId, mobile })).toEqual({
      ok: false,
      reason: "too_soon",
    });
  });

  it("refuses a number already verified on another account", async () => {
    const { mobile } = await verifiedCreator(5);
    const other = await newCreator();
    expect(await requestMobileOtp({ db, notifications }, { userId: other, mobile })).toEqual({
      ok: false,
      reason: "mobile_in_use",
    });
  });

  it("does not let another user redeem someone's challenge", async () => {
    const owner = await newCreator();
    const sent = await requestMobileOtp({ db, notifications }, { userId: owner, mobile: mobileEnding(5) });
    if (!sent.ok) throw new Error("setup");
    const attacker = await newCreator();
    expect(
      await verifyMobileOtp({ db, notifications }, { userId: attacker, challengeId: sent.challengeId, code: "123456" }),
    ).toMatchObject({
      reason: "not_found",
    });
  });
});

describe("identity prefill (mobile → name, masked PAN)", () => {
  it("requires a verified mobile", async () => {
    const userId = await newCreator();
    expect(
      await fetchIdentityPrefill({ db, identityLookup }, { userId, consentDefinitionId: PREFILL_CONSENT }),
    ).toEqual({
      ok: false,
      reason: "mobile_not_verified",
    });
  });

  it("records a versioned consent, stores only the masked PAN and never the full PAN", async () => {
    const { userId, mobile } = await verifiedCreator(4);
    const r = await fetchIdentityPrefill({ db, identityLookup }, { userId, consentDefinitionId: PREFILL_CONSENT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.panMasked).toMatch(/^XXXXX[0-9]{4}[A-Z]$/);

    const full = await identityLookup.lookupByMobile({ mobile: `+91${mobile}`, consentReceiptId: "x" });
    if (full.status !== "found") throw new Error("mock");
    expect(maskPan(full.pan)).toBe(r.panMasked);

    const [stored] = await db.select().from(identityLookupResults).where(eq(identityLookupResults.userId, userId));
    expect(stored).toMatchObject({ verifiedName: full.fullName, panMasked: r.panMasked });

    const [receipt] = await db
      .select({ key: consentDefinitions.key, version: consentDefinitions.version, status: consentReceipts.status })
      .from(consentReceipts)
      .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
      .where(eq(consentReceipts.id, stored!.consentReceiptId));
    expect(receipt).toEqual({ key: "identity_prefill", version: 1, status: "granted" });

    // The full PAN must not appear anywhere in the database.
    const [hits] = (await db.execute<{ n: number }>(sql`
      select (
        (select count(*) from identity_lookup_results where row_to_json(identity_lookup_results)::text like ${`%${full.pan}%`}) +
        (select count(*) from provider_requests where row_to_json(provider_requests)::text like ${`%${full.pan}%`}) +
        (select count(*) from audit_events where row_to_json(audit_events)::text like ${`%${full.pan}%`}) +
        (select count(*) from consent_receipts where row_to_json(consent_receipts)::text like ${`%${full.pan}%`})
      )::int as n`)) as unknown as [{ n: number }];
    expect(hits.n).toBe(0);

    const calls = await db.select().from(providerRequests).where(eq(providerRequests.userId, userId));
    expect(calls.map((c) => c.operation).sort()).toEqual(["lookup_by_mobile", "send_otp_sms"]);
  });

  it("labels the legal name as verified only when it matches the lookup", async () => {
    const { userId } = await verifiedCreator(4);
    const r = await fetchIdentityPrefill({ db, identityLookup }, { userId, consentDefinitionId: PREFILL_CONSENT });
    if (!r.ok) throw new Error("setup");
    const base = { displayName: "Creator", languages: ["en"] };
    const matched = await saveAboutStep(
      db,
      userId,
      aboutStepSchema.parse({ ...base, legalName: `  ${r.fullName.toUpperCase()} ` }),
    );
    expect(matched.legalNameSource).toBe("verified_lookup");
    const edited = await saveAboutStep(db, userId, aboutStepSchema.parse({ ...base, legalName: "Someone Else" }));
    expect(edited.legalNameSource).toBe("self_declared");
  });

  it("handles numbers the provider doesn't know", async () => {
    const { userId } = await verifiedCreator(0);
    expect(
      await fetchIdentityPrefill({ db, identityLookup }, { userId, consentDefinitionId: PREFILL_CONSENT }),
    ).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("GST lookup by PAN and verification on save", () => {
  async function readyForBusiness(lastDigit: number) {
    const { userId } = await verifiedCreator(lastDigit);
    const r = await fetchIdentityPrefill({ db, identityLookup }, { userId, consentDefinitionId: PREFILL_CONSENT });
    if (!r.ok) throw new Error("prefill failed");
    await saveAboutStep(
      db,
      userId,
      aboutStepSchema.parse({ legalName: r.fullName, displayName: "C", languages: ["en"] }),
    );
    await saveProfileStep(
      db,
      userId,
      profileStepSchema.parse({
        primaryCreatorHandle: `c${Date.now()}${seq}`,
        categories: ["tech"],
        platforms: ["youtube"],
      }),
    );
    return userId;
  }

  it("requires the identity-prefill consent", async () => {
    const { userId } = await verifiedCreator(4);
    expect(await findGstRegistrationsForUser({ db, identityLookup, taxRegistry }, userId)).toEqual({
      ok: false,
      reason: "consent_required",
    });
  });

  it("finds registrations, suggests the legal form, and stores the chosen one with provenance", async () => {
    const userId = await readyForBusiness(4);
    const found = await findGstRegistrationsForUser({ db, identityLookup, taxRegistry }, userId);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.registrations).toHaveLength(1);
    const [reg] = found.registrations;
    expect(reg).toMatchObject({
      status: "active",
      constitution: "Proprietorship",
      suggestedLegalForm: "sole_proprietorship",
      pilotSupported: true,
    });

    const saved = await saveBusinessStep(
      db,
      userId,
      businessStepSchema.parse({ legalForm: "sole_proprietorship", gstStatus: "registered", gstin: reg!.gstin }),
      { taxRegistry },
    );
    expect(saved).toMatchObject({ gstStatus: "registered", gstin: reg!.gstin });
    const [stored] = await db
      .select()
      .from(creatorGstRegistrations)
      .where(eq(creatorGstRegistrations.creatorId, saved.id));
    expect(stored).toMatchObject({
      registrationStatus: "active",
      source: "lookup_by_pan",
      constitution: "Proprietorship",
    });
  });

  it("lists cancelled registrations after active ones, and rejects saving a cancelled GSTIN", async () => {
    const userId = await readyForBusiness(7);
    const found = await findGstRegistrationsForUser({ db, identityLookup, taxRegistry }, userId);
    if (!found.ok) throw new Error("lookup");
    expect(found.registrations.map((r) => r.status)).toEqual(["active", "cancelled"]);
    await expect(
      saveBusinessStep(
        db,
        userId,
        businessStepSchema.parse({
          legalForm: "individual",
          gstStatus: "registered",
          gstin: found.registrations[1]!.gstin,
        }),
        { taxRegistry },
      ),
    ).rejects.toMatchObject({ code: "gstin_not_active", field: "gstin" });
  });

  it("rejects a GSTIN registered to a company (not supported in the pilot)", async () => {
    const userId = await readyForBusiness(9);
    const found = await findGstRegistrationsForUser({ db, identityLookup, taxRegistry }, userId);
    if (!found.ok) throw new Error("lookup");
    expect(found.registrations[0]).toMatchObject({ suggestedLegalForm: "private_limited", pilotSupported: false });
    await expect(
      saveBusinessStep(
        db,
        userId,
        businessStepSchema.parse({
          legalForm: "individual",
          gstStatus: "registered",
          gstin: found.registrations[0]!.gstin,
        }),
        { taxRegistry },
      ),
    ).rejects.toMatchObject({ code: "unsupported_legal_form" });
  });

  it("returns no registrations when none exist, and a typed GSTIN is recorded as manual entry", async () => {
    const userId = await readyForBusiness(2);
    const found = await findGstRegistrationsForUser({ db, identityLookup, taxRegistry }, userId);
    expect(found).toEqual({ ok: true, registrations: [] });
    const saved = await saveBusinessStep(
      db,
      userId,
      businessStepSchema.parse({ legalForm: "individual", gstStatus: "registered", gstin: "27AAPFU0939F1ZV" }),
      { taxRegistry },
    );
    const [stored] = await db
      .select()
      .from(creatorGstRegistrations)
      .where(eq(creatorGstRegistrations.creatorId, saved.id));
    expect(stored!.source).toBe("manual_entry");
  });

  it("keeps provider_requests append-only", async () => {
    const [row] = await db.select().from(providerRequests).limit(1);
    await expect(db.delete(providerRequests).where(eq(providerRequests.id, row!.id))).rejects.toThrow();
  });
});
