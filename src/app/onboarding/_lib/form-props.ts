import "server-only";

import type { DbExecutor } from "@/db/types";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { PILOT_SUPPORTED_LEGAL_FORMS } from "@/modules/creator-profile/domain";
import { constitutionToLegalForm, type GstRegistrationView } from "@/modules/creator-profile/gst-registration";
import {
  getMobileStatus,
  listCategories,
  listPlatforms,
  type OnboardingState,
} from "@/modules/creator-profile/queries";
import { GST_STATUS_OPTIONS, INDIAN_STATES, LANGUAGES, LEGAL_FORM_OPTIONS } from "@/modules/creator-profile/reference";
import { isPilotSupportedLegalForm } from "@/modules/creator-profile/rules";
import { getIdentityPrefill, getIdentityPrefillConsent } from "@/modules/identity/identity-prefill";

/**
 * Builds the props for each profile form from stored state. Shared by
 * onboarding steps and Passport edit screens so both show identical data.
 */

export async function aboutFormProps(db: DbExecutor, userId: string, { profile }: OnboardingState) {
  const [mobile, prefill, consent] = await Promise.all([
    getMobileStatus(db, userId),
    getIdentityPrefill(db, userId),
    getIdentityPrefillConsent(db),
  ]);
  return {
    languages: LANGUAGES.map((l) => ({ code: l.code, label: l.label })),
    states: [...INDIAN_STATES],
    identity: {
      maskedMobile: mobile?.maskedMobile ?? null,
      prefill: prefill ? { fullName: prefill.verifiedName, panMasked: prefill.panMasked } : null,
    },
    prefillConsent: consent
      ? { id: consent.id, title: consent.title, purpose: consent.purpose, body: consent.body, version: consent.version }
      : null,
    saved: profile
      ? {
          legalName: profile.legalName,
          displayName: profile.displayName,
          city: profile.city,
          state: profile.state,
          languages: profile.languages,
          languagesOther: profile.languagesOther,
        }
      : null,
  };
}

export async function profileFormProps(
  db: DbExecutor,
  { profile, socialAccounts, additionalCategories }: OnboardingState,
) {
  const [categories, platforms] = await Promise.all([listCategories(db), listPlatforms(db)]);
  // Declared rows plus connected rows (shown with the handle the creator declared).
  const listed = socialAccounts.filter((a) => a.connectionStatus === "declared" || a.connectionStatus === "connected");
  return {
    categories,
    platforms,
    maxMonth: new Date().toISOString().slice(0, 7),
    saved: {
      primaryCreatorHandle: profile?.primaryCreatorHandle ?? null,
      creatorCategory: profile?.creatorCategory ?? null,
      additionalCategories,
      creatorSince: profile?.creatorSince ? profile.creatorSince.slice(0, 7) : null,
      platforms: Object.fromEntries(
        listed
          .filter((a) => a.connectionStatus === "declared" || a.declaredHandle)
          .map((a) => [a.platform, a.connectionStatus === "declared" ? a.handle : (a.declaredHandle ?? a.handle)]),
      ),
    },
  };
}

export async function businessFormProps(db: DbExecutor, userId: string, { profile, gstRegistration }: OnboardingState) {
  const [mobile, consented] = await Promise.all([
    getMobileStatus(db, userId),
    hasValidConsent(db, userId, CONSENT_KEYS.identityPrefill),
  ]);
  const supported = new Set<string>(PILOT_SUPPORTED_LEGAL_FORMS);
  let registration: GstRegistrationView | null = null;
  if (gstRegistration && gstRegistration.registrationStatus !== "not_found") {
    const form = constitutionToLegalForm(gstRegistration.constitution);
    registration = {
      gstin: gstRegistration.gstin,
      status: gstRegistration.registrationStatus,
      legalName: gstRegistration.legalName,
      tradeName: gstRegistration.tradeName,
      constitution: gstRegistration.constitution,
      stateCode: gstRegistration.stateCode ?? gstRegistration.gstin.slice(0, 2),
      registeredOn: gstRegistration.registeredOn,
      suggestedLegalForm: form,
      pilotSupported: form ? isPilotSupportedLegalForm(form) : true,
    };
  }
  return {
    legalForms: LEGAL_FORM_OPTIONS.map((o) => ({ ...o, supported: supported.has(o.value) })),
    gstStatuses: [...GST_STATUS_OPTIONS],
    lookupAvailable: Boolean(mobile && consented),
    saved: {
      legalForm: profile?.legalForm ?? null,
      gstStatus: profile?.gstStatus ?? null,
      gstin: profile?.gstin ?? null,
      registration,
    },
  };
}

export async function interestsFormProps(db: DbExecutor, { preferences }: OnboardingState) {
  return {
    categories: await listCategories(db),
    saved: preferences
      ? {
          prInterest: preferences.prInterest,
          preferredCategories: preferences.preferredCategories,
          brandInterests: preferences.brandInterests,
          travelInterest: preferences.travelInterest,
        }
      : null,
  };
}
