import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  auditEvents,
  consentDefinitions,
  consentReceipts,
  creatorPreferences,
  creatorProfiles,
  creatorSocialAccounts,
} from "@/db/schema";
import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import { ConsentError } from "@/modules/consent";
import {
  OnboardingError,
  completeOnboarding,
  saveAboutStep,
  saveBusinessStep,
  saveInterestsStep,
  saveProfileStep,
} from "@/modules/creator-profile/onboarding-service";
import { getCreatorDashboard } from "@/modules/creator-profile/queries";
import { aboutStepSchema, businessStepSchema, profileStepSchema } from "@/modules/creator-profile/schemas";
import { signUpCreator } from "@/modules/identity/auth/auth-service";

import { authDepsFor, testEmail, connectTestDb } from "../support/db";

const { db } = connectTestDb();
const deps = authDepsFor(db);
const CONSENT_V1 = CONSENT_DEFINITION_SEEDS[0].id;

async function newCreator() {
  const r = await signUpCreator(deps, { email: testEmail(), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  return r.user.userId;
}

const about = aboutStepSchema.parse({
  legalName: "Meher Iyer",
  displayName: "Meher Moves",
  city: "Chennai",
  state: "Tamil Nadu",
  languages: ["ta", "en"],
});
const profile = profileStepSchema.parse({
  primaryCreatorHandle: "@meher.moves.test",
  categories: ["fitness", "food"],
  primaryCategory: "fitness",
  creatorSince: "2020-02",
  platforms: ["instagram", "youtube"],
  platformHandles: { youtube: "MeherMovesTV" },
});

async function throughInterests(userId: string, business = { legalForm: "individual", gstStatus: "not_registered" }) {
  await saveAboutStep(db, userId, about);
  await saveProfileStep(db, userId, profile);
  await saveBusinessStep(db, userId, businessStepSchema.parse(business));
  await saveInterestsStep(db, userId, {
    prInterest: true,
    preferredCategories: ["fitness"],
    brandInterests: ["fitness", "food"],
    travelInterest: false,
  });
}

describe("Cohort A0 onboarding", () => {
  let userId: string;
  beforeAll(async () => {
    userId = await newCreator();
  });

  it("persists every step and completes with a versioned consent receipt", async () => {
    await throughInterests(userId);
    const completed = await completeOnboarding(db, userId, { consentDefinitionId: CONSENT_V1 });

    expect(completed).toMatchObject({
      profileStatus: "completed",
      lastCompletedStep: "consent",
      legalName: "Meher Iyer",
      displayName: "Meher Moves",
      primaryCreatorHandle: "meher.moves.test",
      creatorCategory: "fitness",
      creatorSince: "2020-02-01",
      legalForm: "individual",
      gstStatus: "not_registered",
      gstin: null,
      country: "IN",
      languages: ["ta", "en"],
    });

    const accounts = await db
      .select()
      .from(creatorSocialAccounts)
      .where(eq(creatorSocialAccounts.creatorId, completed.id));
    expect(accounts.map((a) => [a.platform, a.handle, a.connectionStatus, a.provider]).sort()).toEqual([
      ["instagram", "meher.moves.test", "declared", "self_declared"],
      ["youtube", "MeherMovesTV", "declared", "self_declared"],
    ]);

    const [prefs] = await db.select().from(creatorPreferences).where(eq(creatorPreferences.creatorId, completed.id));
    expect(prefs).toMatchObject({
      prInterest: true,
      preferredCategories: ["fitness"],
      brandInterests: ["fitness", "food"],
    });

    const receipts = await db
      .select({
        status: consentReceipts.status,
        version: consentDefinitions.version,
        key: consentDefinitions.key,
        source: consentReceipts.source,
      })
      .from(consentReceipts)
      .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
      .where(eq(consentReceipts.userId, userId));
    expect(receipts).toEqual([{ status: "granted", version: 1, key: "creator_profile", source: "onboarding" }]);
  });

  it("exposes a dashboard read model with no restricted fields and no connected accounts", async () => {
    const view = await getCreatorDashboard(db, userId);
    expect(view).toMatchObject({ displayName: "Meher Moves", handle: "meher.moves.test", connectedAccounts: 0 });
    expect(view!.completion.percent).toBe(80);
    expect(JSON.stringify(view)).not.toMatch(/gstin|legalName/i);
  });

  it("refuses edits through onboarding once completed", async () => {
    await expect(saveAboutStep(db, userId, about)).rejects.toMatchObject({ code: "already_completed" });
    await expect(completeOnboarding(db, userId, { consentDefinitionId: CONSENT_V1 })).rejects.toBeInstanceOf(
      OnboardingError,
    );
  });
});

describe("onboarding rules", () => {
  it("cannot skip ahead of the next incomplete step", async () => {
    const userId = await newCreator();
    await saveAboutStep(db, userId, about);
    await expect(
      saveBusinessStep(db, userId, businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" })),
    ).rejects.toMatchObject({ code: "step_locked" });
    await expect(completeOnboarding(db, userId, { consentDefinitionId: CONSENT_V1 })).rejects.toMatchObject({
      code: "step_locked",
    });
  });

  it("requires the profile to exist before later steps", async () => {
    const userId = await newCreator();
    await expect(saveProfileStep(db, userId, profile)).rejects.toMatchObject({ code: "profile_missing" });
  });

  it("rejects unknown categories and platforms from the reference tables", async () => {
    const userId = await newCreator();
    await saveAboutStep(db, userId, about);
    await expect(saveProfileStep(db, userId, { ...profile, creatorCategory: "astrology" })).rejects.toMatchObject({
      code: "unknown_category",
    });
    await expect(
      saveProfileStep(db, userId, { ...profile, platforms: [{ code: "myspace", handle: "x1" }] }),
    ).rejects.toMatchObject({ code: "unknown_platform" });
  });

  it("rejects a creator-since month in the future", async () => {
    const userId = await newCreator();
    await saveAboutStep(db, userId, about);
    await expect(
      saveProfileStep(db, userId, { ...profile, creatorSince: "2026-11" }, new Date("2026-10-02T00:00:00Z")),
    ).rejects.toMatchObject({ code: "future_month" });
  });

  it("replaces self-declared platforms on re-save without regressing progress", async () => {
    const userId = await newCreator();
    await saveAboutStep(db, userId, about);
    await saveProfileStep(db, userId, profile);
    await saveBusinessStep(
      db,
      userId,
      businessStepSchema.parse({ legalForm: "individual", gstStatus: "not_registered" }),
    );
    const updated = await saveProfileStep(db, userId, {
      ...profile,
      platforms: [{ code: "linkedin", handle: "meher-iyer" }],
    });
    expect(updated.lastCompletedStep).toBe("business");
    const accounts = await db
      .select()
      .from(creatorSocialAccounts)
      .where(eq(creatorSocialAccounts.creatorId, updated.id));
    expect(accounts.map((a) => a.platform)).toEqual(["linkedin"]);
  });
});

describe("GST capture", () => {
  it("stores a GSTIN for a registered creator and clears it if they change to not registered", async () => {
    const userId = await newCreator();
    await saveAboutStep(db, userId, about);
    await saveProfileStep(db, userId, profile);

    const registered = await saveBusinessStep(
      db,
      userId,
      businessStepSchema.parse({ legalForm: "sole_proprietorship", gstStatus: "registered", gstin: "27AAPFU0939F1ZV" }),
    );
    expect(registered).toMatchObject({
      gstStatus: "registered",
      gstin: "27AAPFU0939F1ZV",
      legalForm: "sole_proprietorship",
    });

    const changed = await saveBusinessStep(
      db,
      userId,
      businessStepSchema.parse({
        legalForm: "sole_proprietorship",
        gstStatus: "not_registered",
        gstin: "27AAPFU0939F1ZV",
      }),
    );
    expect(changed).toMatchObject({ gstStatus: "not_registered", gstin: null });
  });

  it("completes onboarding for 'unknown / requires review' — the creator is not blocked", async () => {
    const userId = await newCreator();
    await throughInterests(userId, { legalForm: "individual", gstStatus: "unknown_requires_review" });
    const done = await completeOnboarding(db, userId, { consentDefinitionId: CONSENT_V1 });
    expect(done).toMatchObject({ profileStatus: "completed", gstStatus: "unknown_requires_review" });
  });

  it("never writes the GSTIN into audit metadata", async () => {
    const [{ n }] = (await db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_events where metadata::text ilike ${"%27AAPFU0939F1ZV%"}`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(0);
    const declared = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "onboarding.business_status_declared"));
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.some((e) => e.metadata.gst_id_provided === true)).toBe(true);
  });
});

describe("consent versioning in onboarding", () => {
  it("rejects completion against a definition for a different purpose", async () => {
    const userId = await newCreator();
    await throughInterests(userId);
    const [other] = await db
      .insert(consentDefinitions)
      .values({
        key: "test_other_purpose",
        version: 1,
        title: "t",
        purpose: "p",
        body: "b",
        activeFrom: new Date("2026-01-01Z"),
      })
      .returning();
    await expect(completeOnboarding(db, userId, { consentDefinitionId: other!.id })).rejects.toBeInstanceOf(
      ConsentError,
    );
    const [p] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, userId));
    expect(p!.profileStatus).toBe("draft");
  });
});
