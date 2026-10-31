import type { DbExecutor } from "@/db/types";

import { getOnboardingState } from "./queries";
import { computeProfileCompletion } from "./rules";

/** Passport items that depend on a consent or a connected account — never part of a points milestone. */
const CONSENT_BOUND_ITEMS = new Set(["consent", "connected"]);

/**
 * Whether the creator has filled in every profile detail they type in
 * themselves (name, location, languages, handle, category, tenure, platforms,
 * business status, interests). Connecting an account and the Creator Profile
 * consent are deliberately left out: points must never reward a consent.
 */
export async function profileDetailsComplete(db: DbExecutor, userId: string): Promise<boolean> {
  const { profile, preferences, socialAccounts } = await getOnboardingState(db, userId);
  if (!profile) return false;
  const { items } = computeProfileCompletion({
    displayName: profile.displayName,
    legalName: profile.legalName,
    city: profile.city,
    state: profile.state,
    languages: profile.languages,
    primaryCreatorHandle: profile.primaryCreatorHandle,
    creatorCategory: profile.creatorCategory,
    creatorSince: profile.creatorSince,
    declaredPlatforms: socialAccounts.filter((a) => a.connectionStatus !== "disconnected").length,
    connectedAccounts: 0,
    legalForm: profile.legalForm,
    gstStatus: profile.gstStatus,
    hasInterests: Boolean(
      preferences && (preferences.prInterest || preferences.travelInterest || preferences.brandInterests.length > 0),
    ),
    hasCreatorProfileConsent: false,
  });
  return items.filter((i) => !CONSENT_BOUND_ITEMS.has(i.key)).every((i) => i.done);
}
