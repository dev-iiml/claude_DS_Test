import { asc, desc, eq } from "drizzle-orm";

import {
  creatorAdditionalCategories,
  creatorCategories,
  creatorGstRegistrations,
  creatorPreferences,
  creatorProfiles,
  creatorSocialAccounts,
  socialPlatforms,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";

import { computeProfileCompletion } from "./rules";

export type CreatorPreferences = typeof creatorPreferences.$inferSelect;
export type CreatorSocialAccount = typeof creatorSocialAccounts.$inferSelect;

export interface OnboardingState {
  profile: typeof creatorProfiles.$inferSelect | null;
  preferences: CreatorPreferences | null;
  socialAccounts: CreatorSocialAccount[];
  additionalCategories: string[];
  gstRegistration: typeof creatorGstRegistrations.$inferSelect | null;
}

export async function getOnboardingState(db: DbExecutor, userId: string): Promise<OnboardingState> {
  const [profile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, userId)).limit(1);
  if (!profile)
    return { profile: null, preferences: null, socialAccounts: [], additionalCategories: [], gstRegistration: null };

  const [preferences] = await db
    .select()
    .from(creatorPreferences)
    .where(eq(creatorPreferences.creatorId, profile.id))
    .limit(1);
  const socialAccounts = await db
    .select()
    .from(creatorSocialAccounts)
    .where(eq(creatorSocialAccounts.creatorId, profile.id))
    .orderBy(asc(creatorSocialAccounts.createdAt));

  const additional = await db
    .select({ code: creatorAdditionalCategories.categoryCode })
    .from(creatorAdditionalCategories)
    .where(eq(creatorAdditionalCategories.creatorId, profile.id))
    .orderBy(asc(creatorAdditionalCategories.createdAt));
  const [gstRegistration] = profile.gstin
    ? await db
        .select()
        .from(creatorGstRegistrations)
        .where(eq(creatorGstRegistrations.creatorId, profile.id))
        .orderBy(desc(creatorGstRegistrations.verifiedAt))
        .limit(1)
    : [];

  return {
    profile,
    preferences: preferences ?? null,
    socialAccounts,
    additionalCategories: additional.map((a) => a.code),
    gstRegistration: gstRegistration && gstRegistration.gstin === profile.gstin ? gstRegistration : null,
  };
}

/** Verified mobile (masked) for display, or null. */
export async function getMobileStatus(db: DbExecutor, userId: string): Promise<{ maskedMobile: string } | null> {
  const [u] = await db
    .select({ mobile: users.mobile, verifiedAt: users.mobileVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.mobile || !u.verifiedAt) return null;
  return { maskedMobile: `${u.mobile.slice(0, 3)} ••••• ${u.mobile.slice(-5)}` };
}

export async function getProfileStatus(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);
  return row?.status ?? null;
}

/** True once onboarding is finished — including while membership is paused. */
export async function isOnboardingComplete(db: DbExecutor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);
  return row?.status === "completed" || row?.status === "paused";
}

export interface ReferenceOption {
  code: string;
  label: string;
}

export async function listCategories(db: DbExecutor): Promise<ReferenceOption[]> {
  return db
    .select({ code: creatorCategories.code, label: creatorCategories.label })
    .from(creatorCategories)
    .where(eq(creatorCategories.isActive, true))
    .orderBy(asc(creatorCategories.sortOrder));
}

export async function listPlatforms(db: DbExecutor): Promise<ReferenceOption[]> {
  return db
    .select({ code: socialPlatforms.code, label: socialPlatforms.label })
    .from(socialPlatforms)
    .where(eq(socialPlatforms.isActive, true))
    .orderBy(asc(socialPlatforms.sortOrder));
}

/** Read model for the creator dashboard. Contains no restricted fields (no GSTIN). */
export async function getCreatorDashboard(db: DbExecutor, userId: string) {
  const state = await getOnboardingState(db, userId);
  const { profile, preferences, socialAccounts, additionalCategories } = state;
  if (!profile) return null;
  const categoryLabels = new Map((await listCategories(db)).map((c) => [c.code, c.label]));
  const categories = [profile.creatorCategory, ...additionalCategories]
    .filter((c): c is string => Boolean(c))
    .map((code, i) => ({ code, label: categoryLabels.get(code) ?? code, primary: i === 0 }));

  const consented = await hasValidConsent(db, userId, CONSENT_KEYS.creatorProfile);
  const declared = socialAccounts.filter((a) => a.connectionStatus === "declared");
  const connected = socialAccounts.filter((a) => a.connectionStatus === "connected");
  const platformLabels = new Map((await listPlatforms(db)).map((p) => [p.code, p.label]));

  const completion = computeProfileCompletion({
    displayName: profile.displayName,
    legalName: profile.legalName,
    city: profile.city,
    state: profile.state,
    languages: profile.languages,
    primaryCreatorHandle: profile.primaryCreatorHandle,
    creatorCategory: profile.creatorCategory,
    creatorSince: profile.creatorSince,
    declaredPlatforms: declared.length,
    connectedAccounts: connected.length,
    legalForm: profile.legalForm,
    gstStatus: profile.gstStatus,
    hasInterests: Boolean(
      preferences && (preferences.prInterest || preferences.travelInterest || preferences.brandInterests.length > 0),
    ),
    hasCreatorProfileConsent: consented,
  });

  return {
    displayName: profile.displayName,
    handle: profile.primaryCreatorHandle,
    creatorCategory: profile.creatorCategory,
    categories,
    profileStatus: profile.profileStatus,
    completion,
    declaredPlatforms: declared.map((a) => ({
      platform: platformLabels.get(a.platform) ?? a.platform,
      handle: a.handle,
    })),
    connectedAccounts: connected.length,
  };
}
