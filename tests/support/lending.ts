import { eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { users } from "@/db/schema";
import { CONSENT_KEYS } from "@/modules/consent";
import { CONSENT_DEFINITION_SEEDS, currentDefinitionSeed } from "@/modules/consent/definitions";
import {
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import {
  runBureauCheck,
  saveApplicationDetails,
  startApplication,
} from "@/modules/financial-eligibility/application-service";
import { applicationDetailsSchema } from "@/modules/financial-eligibility/schemas";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { grantPurpose } from "@/modules/privacy";
import { runUnderwriting } from "@/modules/underwriting/underwriting-service";
import { MockCreditBureauProvider } from "@/providers/bureau/mock-credit-bureau-provider";

import { authDepsFor, testEmail } from "./db";
import { shareAndConfirm } from "./eligibility";

/**
 * Lending fixtures: creators with a confirmed, underwritten check (strong
 * bureau, bank shared, all accounts declared), optionally sharing with a
 * partner lender, and staff users. `panSeed` keeps PANs unique per test file.
 */
export function lendingFixtures(db: Database, opts: { panSeed?: number } = {}) {
  const auth = authDepsFor(db);
  const seed = (k: string) => currentDefinitionSeed(k)!.id;
  const details = applicationDetailsSchema.parse({
    purposes: ["equipment"],
    requestedAmount: "1,50,000",
    declaredMonthlyIncome: "90,000",
    declaredMonthlyEmi: "0",
    incomeSources: ["brand_deals", "platform_payouts"],
  });
  let panSeq = opts.panSeed ?? 0;
  const uniquePan = () => {
    panSeq += 1;
    const l = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    return `${l[panSeq % 24]}${l[(panSeq >> 3) % 24]}ZP${l[(panSeq >> 6) % 24]}1238F`.slice(0, 10);
  };

  async function member(label: string) {
    const r = await signUpCreator(auth, { email: testEmail(label), password: "a long enough passphrase" });
    if (!r.ok) throw new Error("signup failed");
    const userId = r.user.userId;
    await saveAboutStep(
      db,
      userId,
      aboutStepSchema.parse({
        legalName: "Ira Sen",
        displayName: "Ira",
        city: "Pune",
        state: "Maharashtra",
        languages: ["en"],
      }),
    );
    await saveProfileStep(
      db,
      userId,
      profileStepSchema.parse({
        primaryCreatorHandle: `ira.${label}.test`,
        categories: ["photography"],
        primaryCategory: "photography",
        creatorSince: "2019-03",
        platforms: ["youtube"],
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
    await completeOnboarding(db, userId, {
      consentDefinitionId: CONSENT_DEFINITION_SEEDS.find((d) => d.key === CONSENT_KEYS.creatorProfile)!.id,
    });
    return userId;
  }

  /** A creator with a confirmed, underwritten check (strong bureau, bank shared, all accounts declared). */
  async function confirmedCheck(label: string, opts: { pan?: string; share?: boolean } = {}) {
    const userId = await member(label);
    const app = await startApplication(
      { db },
      { userId, consentDefinitionId: seed(CONSENT_KEYS.financialEligibility), source: "settings" },
    );
    await saveApplicationDetails({ db }, { userId, applicationId: app.id, details });
    await runBureauCheck(
      { db, bureau: new MockCreditBureauProvider() },
      { userId, applicationId: app.id, pan: opts.pan ?? uniquePan() },
    );
    await shareAndConfirm(db, { userId, applicationId: app.id, mobile: "9876543215" });
    await runUnderwriting(db, { userId, applicationId: app.id });
    if (opts.share !== false) {
      await grantPurpose(
        { db },
        {
          userId,
          key: CONSENT_KEYS.lenderSharing,
          consentDefinitionId: seed(CONSENT_KEYS.lenderSharing),
          source: "settings",
        },
      );
    }
    return { userId, applicationId: app.id };
  }

  async function staff(label: string, role: "risk_admin" | "ops_admin" = "risk_admin") {
    const r = await signUpCreator(auth, { email: testEmail(label), password: "a long enough passphrase" });
    if (!r.ok) throw new Error("signup failed");
    await db.update(users).set({ role }).where(eq(users.id, r.user.userId));
    return r.user.userId;
  }

  return { member, confirmedCheck, staff, details, seed, uniquePan };
}
