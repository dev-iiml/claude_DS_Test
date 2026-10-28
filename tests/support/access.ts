import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { creatorProfessionalFeatures, creatorProfiles, professionalGraphRuns, users } from "@/db/schema";
import { createOpportunity, type OpportunityInput } from "@/modules/access/access-service";
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
import { refreshCreatorStatus } from "@/modules/creator-status/status-service";
import { signUpCreator } from "@/modules/identity/auth/auth-service";

import { authDepsFor, testEmail } from "./db";

export const def = (key: string) => CONSENT_DEFINITION_SEEDS.find((d) => d.key === key)!.id;
export const brandConsentId = () => currentDefinitionSeed(CONSENT_KEYS.brandOpportunities)!.id;

let handles = 0;

/** A completed Cohort A0 member (no connected accounts, so Creator Status is Member). */
export async function accessMember(db: Database, label = "access") {
  handles += 1;
  const r = await signUpCreator(authDepsFor(db), { email: testEmail(label), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  const handle = `${label}.${Date.now().toString(36)}.${handles}`;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Meera Pillai",
      displayName: "Meera Makes",
      city: "Kochi",
      state: "Kerala",
      languages: ["ml"],
    }),
  );
  await saveProfileStep(
    db,
    userId,
    profileStepSchema.parse({
      primaryCreatorHandle: handle,
      categories: ["beauty"],
      primaryCategory: "beauty",
      creatorSince: "2019-01",
      platforms: ["instagram"],
    }),
  );
  await saveBusinessStep(
    db,
    userId,
    businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" }),
  );
  await saveInterestsStep(db, userId, {
    prInterest: true,
    preferredCategories: [],
    brandInterests: [],
    travelInterest: false,
  });
  await completeOnboarding(db, userId, { consentDefinitionId: def(CONSENT_KEYS.creatorProfile) });
  const [p] = await db
    .select({ id: creatorProfiles.id })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId));
  return { userId, creatorId: p!.id };
}

export const ONYX_SIGNALS = {
  connected_platforms: 1,
  professional_longevity_months: 36,
  total_audience: 60_000,
  engagement_rate_3m: 0.03,
  posting_consistency_12m: 0.8,
  engagement_stability: 0.5,
  follower_spike_detected: false,
  handle_mismatches: 0,
} as const;

export const ICON_SIGNALS = {
  ...ONYX_SIGNALS,
  connected_platforms: 2,
  professional_longevity_months: 60,
  total_audience: 400_000,
  engagement_rate_3m: 0.04,
  engagement_stability: 0.8,
} as const;

/**
 * Stores a Professional Graph run with the given signal values (as the engine
 * would) and recalculates Creator Status from it through the real service.
 */
export async function giveSignals(
  db: Database,
  creatorId: string,
  signals: Record<string, number | boolean | null>,
  now = new Date(),
) {
  const [run] = await db
    .insert(professionalGraphRuns)
    .values({
      creatorId,
      engineVersion: "pg-test",
      inputsHash: randomBytes(32).toString("hex"),
      snapshotCount: 0,
      trigger: "system",
      computedAt: now,
    })
    .returning({ id: professionalGraphRuns.id });
  await db.insert(creatorProfessionalFeatures).values(
    Object.entries(signals).map(([key, value]) => ({
      runId: run!.id,
      creatorId,
      featureKey: key,
      featureVersion: "1",
      valueNumeric: typeof value === "number" ? String(value) : null,
      valueBoolean: typeof value === "boolean" ? value : null,
      unit: "count",
      source: (key === "professional_longevity_months" || key === "connected_platforms" ? "verified" : "derived") as
        "verified" | "derived",
      completeness: value === null ? "0" : "1",
      confidence: "high" as const,
      computedAt: now,
    })),
  );
  const status = await refreshCreatorStatus(db, { creatorId, graphRunId: run!.id, now });
  return { graphRunId: run!.id, ...status! };
}

/** A partnerships admin (staff) user. */
export async function partnershipsAdmin(db: Database) {
  const r = await signUpCreator(authDepsFor(db), { email: testEmail("desk"), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  await db.update(users).set({ role: "partnerships_admin" }).where(eq(users.id, r.user.userId));
  return r.user.userId;
}

let slugs = 0;
export async function opportunity(db: Database, staffUserId: string, values: Partial<OpportunityInput> = {}) {
  slugs += 1;
  return createOpportunity(db, {
    staffUserId,
    values: {
      slug: `test-opportunity-${Date.now().toString(36)}-${slugs}`,
      brandName: "Fictional Brand",
      title: "Sample opportunity",
      kind: "pr_drop",
      category: "Beauty",
      summary: "A sample opportunity used only in tests.",
      minTier: "member",
      pointsCost: 300,
      places: 5,
      opensAt: new Date("2026-01-01T00:00:00Z"),
      closesAt: new Date("2030-01-01T00:00:00Z"),
      ...values,
    },
  });
}
