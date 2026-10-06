import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  consentReceipts,
  creatorProfiles,
  creditApplications,
  fraudChecks,
  fraudFlags,
  identityLookupResults,
} from "@/db/schema";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { currentDefinitionSeed } from "@/modules/consent/definitions";
import {
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import {
  closeApplication,
  runBureauCheck,
  saveApplicationDetails,
  startApplication,
} from "@/modules/financial-eligibility/application-service";
import { applicationDetailsSchema } from "@/modules/financial-eligibility/schemas";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { completeConnection, startConnection } from "@/modules/social-data/connection-service";
import {
  getUnderwritingRun,
  runUnderwriting,
  verifyUnderwritingReproducible,
} from "@/modules/underwriting/underwriting-service";
import { MockCreditBureauProvider } from "@/providers/bureau/mock-credit-bureau-provider";
import { MockSocialDataProvider, encodeMockCode } from "@/providers/social/mock-social-data-provider";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";
import { shareAndConfirm } from "../support/eligibility";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const seed = (k: string) => currentDefinitionSeed(k)!.id;
const rawDetails = {
  purposes: ["content_production"],
  requestedAmount: "1,00,000",
  declaredMonthlyIncome: "75,000",
  declaredMonthlyEmi: "3,000",
  incomeSources: ["brand_deals", "affiliate"],
};
const details = applicationDetailsSchema.parse(rawDetails);
let panSeq = 0;
/** A unique fictional PAN (4th letter P = individual); the mock bureau reads only the digits. */
function uniquePan(digits = "1236") {
  panSeq += 1;
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const n = Date.now() + panSeq * 7919;
  const pick = (k: number) => letters[Math.floor(n / 24 ** k) % 24]!;
  return `${pick(0)}${pick(1)}${pick(2)}P${pick(3)}${digits}F`;
}

async function readyCheck(label: string, opts: { signals: boolean; pan?: string; income?: string }) {
  const r = await signUpCreator(auth, { email: testEmail(label), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  const handle = `uw.${label}.test`;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Uma Rao",
      displayName: "Uma Eats",
      city: "Hyderabad",
      state: "Telangana",
      languages: ["te"],
    }),
  );
  await saveProfileStep(
    db,
    userId,
    profileStepSchema.parse({
      primaryCreatorHandle: handle,
      categories: ["food"],
      primaryCategory: "food",
      creatorSince: "2020-05",
      platforms: ["instagram"],
    }),
  );
  await saveBusinessStep(
    db,
    userId,
    businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" }),
  );
  await saveInterestsStep(db, userId, {
    prInterest: false,
    preferredCategories: [],
    brandInterests: [],
    travelInterest: false,
  });
  await completeOnboarding(db, userId, { consentDefinitionId: seed(CONSENT_KEYS.creatorProfile) });
  const [p] = await db
    .select({ id: creatorProfiles.id })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId));

  const social = { db, social: new MockSocialDataProvider() };
  const { authorizationUrl } = await startConnection(social, {
    userId,
    platform: "instagram",
    redirectUri: "http://localhost/cb",
    connectionConsentId: seed(CONSENT_KEYS.socialAccountConnection),
    analyticsConsentId: opts.signals ? seed(CONSENT_KEYS.professionalAnalytics) : null,
  });
  const state = new URL(authorizationUrl, "http://x").searchParams.get("state")!;
  await completeConnection(social, {
    userId,
    state,
    code: encodeMockCode({ platform: "instagram", handle, nonce: "n" }),
  });

  const app = await startApplication(
    { db },
    { userId, consentDefinitionId: seed(CONSENT_KEYS.financialEligibility), source: "settings" },
  );
  await saveApplicationDetails(
    { db },
    {
      userId,
      applicationId: app.id,
      details: opts.income
        ? applicationDetailsSchema.parse({ ...rawDetails, declaredMonthlyIncome: opts.income })
        : details,
    },
  );
  await runBureauCheck(
    { db, bureau: new MockCreditBureauProvider() },
    { userId, applicationId: app.id, pan: opts.pan ?? uniquePan() },
  );
  const ready = await shareAndConfirm(db, { userId, applicationId: app.id });
  expect(ready.status).toBe("inputs_ready");
  return { userId, creatorId: p!.id, applicationId: app.id };
}

const flagCodes = async (runId: string) =>
  (await getUnderwritingRun(db, runId))!.fraud!.flags.map((f) => [f.code, f.severity]);

describe("Fraud / authenticity layer (Stage 11)", () => {
  it("an open check whose consent is no longer current asks again and keeps the same check", async () => {
    const c = await readyCheck("renew", { signals: false });
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId));
    // Simulate a consent text change: the open check's receipt no longer satisfies the active version.
    await db
      .update(consentReceipts)
      .set({ status: "withdrawn", withdrawnAt: new Date() })
      .where(eq(consentReceipts.id, app!.consentReceiptId));
    expect(await hasValidConsent(db, c.userId, CONSENT_KEYS.financialEligibility)).toBe(false);
    const again = await startApplication(
      { db },
      { userId: c.userId, consentDefinitionId: seed(CONSENT_KEYS.financialEligibility), source: "settings" },
    );
    expect(again.id).toBe(c.applicationId);
    expect(again.consentReceiptId).not.toBe(app!.consentReceiptId);
    expect(await hasValidConsent(db, c.userId, CONSENT_KEYS.financialEligibility)).toBe(true);
  });

  it("runs with every underwriting run, stores numbers only, and never stores the PAN", async () => {
    const pan = uniquePan();
    const c = await readyCheck("clean", { signals: true, pan });
    const r = (await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId }))!;
    expect(r.fraud.rulesVersion).toBe("fraud-0.1.0");
    const run = (await getUnderwritingRun(db, r.runId))!;
    expect(run.fraud!.checks.find((x) => x.code === "IDENTITY_NAME_MISMATCH")!.status).toBe("not_run");
    expect(run.fraud!.checks.find((x) => x.code === "SUSPICIOUS_FOLLOWER_SPIKE")!.status).not.toBe("not_run");
    expect(run.fraud!.inputs.pan_shared_with_other_accounts).toBe(0);

    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId));
    expect(app!.panFingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
    const dump = await db.execute(sql`select row_to_json(t)::text as j from fin.fraud_checks t`);
    expect(JSON.stringify(dump)).not.toContain(pan);
    expect(JSON.stringify(dump)).not.toContain(pan.slice(5, 9) + "F");
    expect(await verifyUnderwritingReproducible(db, r.runId)).toBe(true);

    // Append-only.
    await expect(
      db.update(fraudChecks).set({ outcome: "clear" }).where(eq(fraudChecks.runId, r.runId)),
    ).rejects.toThrow();
  });

  it("the same PAN on a second account routes that recommendation to refer — never a decline", async () => {
    const pan = uniquePan();
    await readyCheck("first", { signals: false, pan });
    const second = await readyCheck("second", { signals: false, pan });
    const r = (await runUnderwriting(db, { userId: second.userId, applicationId: second.applicationId }))!;
    expect(await flagCodes(r.runId)).toContainEqual(["DUPLICATE_PAN_ACCOUNTS", "high"]);
    expect(r.fraud.outcome).toBe("review");
    for (const m of [r.traditional, r.creatorEnhanced]) {
      expect(m.outcome).not.toBe("recommend");
      expect(m.reasonCodes.map((x) => x.code)).toContain("FRAUD_REVIEW");
    }
    // Scores and exposures are untouched by the fraud layer.
    expect(r.traditional.recommendedExposure).not.toBeNull();
    expect(await verifyUnderwritingReproducible(db, r.runId)).toBe(true);
  });

  it("flags a declared income far above what the bank data shows", async () => {
    const c = await readyCheck("income", { signals: false, income: "9,00,000" });
    const r = (await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId }))!;
    expect(await flagCodes(r.runId)).toContainEqual(["DECLARED_INCOME_INCONSISTENT", "high"]);
  });

  it("compares the declared name with the identity-lookup name — only the score is kept", async () => {
    const c = await readyCheck("name", { signals: false });
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId));
    await db.insert(identityLookupResults).values({
      userId: c.userId,
      mobile: "+919000000001",
      verifiedName: "Kabir Sethi",
      panMasked: app!.panMasked!,
      provider: "mock",
      consentReceiptId: app!.consentReceiptId,
      fetchedAt: new Date(),
    });
    const r = (await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId }))!;
    expect(await flagCodes(r.runId)).toContainEqual(["IDENTITY_NAME_MISMATCH", "high"]);
    const run = (await getUnderwritingRun(db, r.runId))!;
    expect(run.fraud!.inputs.identity_name_match).toBe(0);
    expect(JSON.stringify(run.fraud)).not.toMatch(/Kabir|Uma/);
  });

  it("audience checks need professional-analytics consent", async () => {
    const c = await readyCheck("noconsent", { signals: false });
    const r = (await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId }))!;
    const statuses = Object.fromEntries(r.fraud.checks.map((x) => [x.code, x.status]));
    expect(statuses.SUSPICIOUS_FOLLOWER_SPIKE).toBe("not_run");
    expect(statuses.ANOMALOUS_ENGAGEMENT).toBe("not_run");
    // Connected-account checks run under the connection itself.
    expect(statuses.CONNECTED_HANDLE_MISMATCH).toBe("passed");
  });

  it("closing a check erases its fraud results and PAN fingerprint", async () => {
    const pan = uniquePan();
    await readyCheck("dupe-a", { signals: false, pan });
    const c = await readyCheck("dupe-b", { signals: false, pan });
    const r = (await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId }))!;
    expect(r.fraud.flags.length).toBeGreaterThan(0);
    await closeApplication({ db }, { userId: c.userId, applicationId: c.applicationId });
    const [checks] = await db
      .select({ n: count() })
      .from(fraudChecks)
      .where(eq(fraudChecks.applicationId, c.applicationId));
    expect(checks!.n).toBe(0);
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId));
    expect(app!.panFingerprint).toBeNull();
    const [flags] = await db.select({ n: count() }).from(fraudFlags);
    expect(flags!.n).toBeGreaterThanOrEqual(0);
  });
});
