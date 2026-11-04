import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brands, creatorProfiles, users } from "@/db/schema";
import { createOpportunity } from "@/modules/access";
import { CONSENT_KEYS } from "@/modules/consent";
import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import {
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import type { UserRole } from "@/modules/identity/domain";

import { authDepsFor, testEmail } from "./db";

export const consentDef = (key: string) => CONSENT_DEFINITION_SEEDS.find((d) => d.key === key)!.id;

/** A creator who finished onboarding. `interests: false` leaves the profile-details points milestone unearned. */
export async function completedMember(db: Database, opts: { handle?: string; interests?: boolean } = {}) {
  const auth = authDepsFor(db);
  const r = await signUpCreator(auth, { email: testEmail("member"), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  const userId = r.user.userId;
  const handle = opts.handle ?? `m.${randomBytes(4).toString("hex")}`;
  await saveAboutStep(
    db,
    userId,
    aboutStepSchema.parse({
      legalName: "Mira Iyer",
      displayName: "Mira Makes",
      city: "Chennai",
      state: "Tamil Nadu",
      languages: ["ta"],
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
    prInterest: opts.interests ?? false,
    preferredCategories: [],
    brandInterests: [],
    travelInterest: false,
  });
  await completeOnboarding(db, userId, { consentDefinitionId: consentDef(CONSENT_KEYS.creatorProfile) });
  const [p] = await db
    .select({ id: creatorProfiles.id })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId));
  return { userId, creatorId: p!.id, handle };
}

export async function staffUser(db: Database, role: UserRole) {
  const r = await signUpCreator(authDepsFor(db), { email: testEmail(role), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  await db.update(users).set({ role }).where(eq(users.id, r.user.userId));
  return r.user.userId;
}

export async function testOpportunity(db: Database, staff: string, over: { pointsCost?: number } = {}) {
  const [b] = await db
    .insert(brands)
    .values({ name: `Test Brand ${randomBytes(4).toString("hex")}`, category: "Beauty", isSample: true })
    .returning({ id: brands.id });
  const now = Date.now();
  return createOpportunity(db, {
    staffUserId: staff,
    values: {
      brandId: b!.id,
      title: "Test Drop",
      kind: "pr_drop",
      category: "Beauty",
      summary: "A test opportunity.",
      details: "Details of a test opportunity.",
      minTier: "member",
      pointsCost: over.pointsCost ?? 0,
      seats: 5,
      opensAt: new Date(now - 86_400_000),
      closesAt: new Date(now + 30 * 86_400_000),
      status: "live",
    },
  });
}
