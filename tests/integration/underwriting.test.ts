import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditEvents, creatorProfiles, creditApplications, underwritingInputs, underwritingRuns } from "@/db/schema";
import { CONSENT_KEYS } from "@/modules/consent";
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
import { withdrawPurpose } from "@/modules/privacy";
import { completeConnection, startConnection } from "@/modules/social-data/connection-service";
import {
  getUnderwritingRun,
  hasUnderwritingRun,
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
const details = applicationDetailsSchema.parse({
  purposes: ["content_production"],
  requestedAmount: "1,00,000",
  declaredMonthlyIncome: "75,000",
  declaredMonthlyEmi: "3,000",
  incomeSources: ["brand_deals", "affiliate"],
});

async function readyCheck(label: string, opts: { signals: boolean }) {
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
  await saveApplicationDetails({ db }, { userId, applicationId: app.id, details });
  await runBureauCheck(
    { db, bureau: new MockCreditBureauProvider() },
    { userId, applicationId: app.id, pan: "ABCPE1236F" },
  );
  const ready = await shareAndConfirm(db, { userId, applicationId: app.id });
  expect(ready.status).toBe("inputs_ready");
  return { userId, creatorId: p!.id, applicationId: app.id };
}

const runsFor = async (applicationId: string) =>
  (await db.select({ n: count() }).from(underwritingRuns).where(eq(underwritingRuns.applicationId, applicationId)))[0]!
    .n;

describe("Underwriting Engine v0", () => {
  it("scores a ready check with both models, stores a reproducible run and reuses it", async () => {
    const c = await readyCheck("full", { signals: true });
    const first = await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId });
    expect(first).not.toBeNull();
    expect(first!.reused).toBe(false);
    expect(first!.traditional.model).toBe("traditional");
    expect(first!.creatorEnhanced.completeness).toBe(0.95);
    expect(first!.creatorEnhanced.reasonCodes.map((r) => r.code)).not.toContain("CREATOR_SIGNALS_UNAVAILABLE");

    const again = await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId });
    expect(again).toMatchObject({ runId: first!.runId, reused: true });
    expect(await runsFor(c.applicationId)).toBe(1);

    const run = await getUnderwritingRun(db, first!.runId);
    expect(run!.professionalRunId).not.toBeNull();
    expect(run!.inputs.filter((i) => i.origin === "professional")).toHaveLength(9);
    expect(run!.inputs.find((i) => i.key === "requested_amount")).toMatchObject({
      origin: "application",
      value: 100_000,
    });
    expect(run!.creatorEnhanced!.recommendedExposure).toBe(first!.creatorEnhanced.recommendedExposure);
    expect(await verifyUnderwritingReproducible(db, first!.runId)).toBe(true);

    // Append-only.
    await expect(
      db.update(underwritingRuns).set({ modelVersion: "x" }).where(eq(underwritingRuns.id, first!.runId)),
    ).rejects.toThrow();
    await expect(db.delete(underwritingInputs).where(eq(underwritingInputs.runId, first!.runId))).rejects.toThrow();

    // The audit trail records the run without figures.
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "underwriting.completed"))
      .limit(1);
    expect(JSON.stringify(event!.metadata)).not.toMatch(/exposure|score|grade|income/i);
  });

  it("without professional analytics, creator signals are unavailable and the models largely converge", async () => {
    const c = await readyCheck("nosignals", { signals: false });
    const r = await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId });
    expect((await getUnderwritingRun(db, r!.runId))!.professionalRunId).toBeNull();
    expect(r!.creatorEnhanced.reasonCodes.map((x) => x.code)).toContain("CREATOR_SIGNALS_UNAVAILABLE");
    expect(r!.creatorEnhanced.components.professional_longevity).toBeNull();
  });

  it("does nothing for checks that aren't ready, or that belong to someone else", async () => {
    const c = await readyCheck("owner", { signals: false });
    const other = await signUpCreator(auth, { email: testEmail("stranger"), password: "a long enough passphrase" });
    if (!other.ok) throw new Error();
    expect(await runUnderwriting(db, { userId: other.user.userId, applicationId: c.applicationId })).toBeNull();
  });

  it("withdrawing professional analytics erases unsent recommendations that used the signals", async () => {
    const c = await readyCheck("analytics", { signals: true });
    await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId });
    expect(await hasUnderwritingRun(db, c.applicationId)).toBe(true);
    await withdrawPurpose({ db }, { userId: c.userId, key: CONSENT_KEYS.professionalAnalytics, source: "settings" });
    expect(await hasUnderwritingRun(db, c.applicationId)).toBe(false);
    // Preparing again uses financial inputs only.
    const r = await runUnderwriting(db, { userId: c.userId, applicationId: c.applicationId });
    expect(r!.creatorEnhanced.reasonCodes.map((x) => x.code)).toContain("CREATOR_SIGNALS_UNAVAILABLE");
  });

  it("closing a check erases its recommendation; a check with a lender keeps it", async () => {
    const closed = await readyCheck("closed", { signals: true });
    await runUnderwriting(db, { userId: closed.userId, applicationId: closed.applicationId });
    await closeApplication({ db }, { userId: closed.userId, applicationId: closed.applicationId });
    expect(await runsFor(closed.applicationId)).toBe(0);

    const sent = await readyCheck("sent", { signals: true });
    await runUnderwriting(db, { userId: sent.userId, applicationId: sent.applicationId });
    await db
      .update(creditApplications)
      .set({ status: "submitted" })
      .where(eq(creditApplications.id, sent.applicationId));
    await withdrawPurpose({ db }, { userId: sent.userId, key: CONSENT_KEYS.professionalAnalytics, source: "settings" });
    expect(await runsFor(sent.applicationId)).toBe(1);
  });
});
