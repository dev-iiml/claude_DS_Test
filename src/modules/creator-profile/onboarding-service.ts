import { and, eq, inArray, ne } from "drizzle-orm";

import {
  creatorAdditionalCategories,
  creatorCategories,
  creatorPreferences,
  creatorProfiles,
  creatorSocialAccounts,
  socialPlatforms,
} from "@/db/schema";
import type { Database } from "@/db/create-db";
import type { DbExecutor } from "@/db/types";
import { callProvider, recordAuditEvent } from "@/modules/audit";
import { recordEvent } from "@/modules/analytics";
import { syncMilestonePoints } from "@/modules/rewards/ledger-service";
import { CONSENT_KEYS, grantConsent, hasValidConsent } from "@/modules/consent";
import { getIdentityPrefill, namesMatch } from "@/modules/identity/identity-prefill";
import { SELF_DECLARED_PROVIDER } from "@/modules/social-data/domain";
import { resolveProvider } from "@/modules/integrations/router";
import type { TaxRegistrationProvider } from "@/providers/tax-registration/types";

import type { OnboardingStep } from "./domain";
import { constitutionToLegalForm, gstinSourceFor, storeGstRegistration } from "./gst-registration";
import {
  advanceProgress,
  canAccessStep,
  isPilotSupportedLegalForm,
  monthToDate,
  normaliseGstDeclaration,
} from "./rules";
import type { AboutStepInput, BusinessStepInput, InterestsStepInput, ProfileStepInput } from "./schemas";
import { isFutureMonth } from "./schemas";

export type CreatorProfile = typeof creatorProfiles.$inferSelect;

/**
 * Business-rule failures surfaced to the creator. Field-level messages map
 * onto form fields; `form` is a general message.
 */
export class OnboardingError extends Error {
  constructor(
    readonly code:
      | "step_locked"
      | "already_completed"
      | "profile_missing"
      | "unknown_category"
      | "unknown_platform"
      | "future_month"
      | "unsupported_legal_form"
      | "gstin_not_active"
      | "consent_required",
    readonly field?: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "OnboardingError";
  }
}

async function findProfile(db: DbExecutor, userId: string): Promise<CreatorProfile | null> {
  const [row] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * "onboarding" edits a draft profile step by step; "passport" edits a
 * completed profile from the Creator Passport (Stage 05). Same rules, same
 * validation — only progress tracking and audit event names differ.
 */
export type EditMode = "onboarding" | "passport";

function assertEditable(
  profile: CreatorProfile | null,
  step: OnboardingStep,
  mode: EditMode = "onboarding",
): asserts profile is CreatorProfile {
  if (!profile) throw new OnboardingError("profile_missing");
  if (mode === "passport") {
    if (profile.profileStatus !== "completed") throw new OnboardingError("step_locked");
    return;
  }
  if (profile.profileStatus !== "draft") throw new OnboardingError("already_completed");
  if (!canAccessStep(step, profile.lastCompletedStep)) throw new OnboardingError("step_locked");
}

async function auditStep(
  db: DbExecutor,
  userId: string,
  profileId: string,
  step: OnboardingStep,
  mode: EditMode = "onboarding",
) {
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: userId,
    eventType: mode === "passport" ? "creator_profile.updated" : "onboarding.step_saved",
    entityType: "creator_profile",
    entityId: profileId,
    metadata: mode === "passport" ? { section: step } : { step },
  });
}

const progressFor = (mode: EditMode, current: OnboardingStep, saved: OnboardingStep) =>
  mode === "passport" ? current : advanceProgress(current, saved);

async function activeCodes(db: DbExecutor, table: typeof creatorCategories | typeof socialPlatforms, codes: string[]) {
  if (codes.length === 0) return new Set<string>();
  const rows = await db
    .select({ code: table.code })
    .from(table)
    .where(and(inArray(table.code, codes), eq(table.isActive, true)));
  return new Set(rows.map((r) => r.code));
}

// --- Step 2: About you --------------------------------------------------------

/** Creates the draft profile on first save; updates it on revisits. */
export async function saveAboutStep(
  db: Database,
  userId: string,
  input: AboutStepInput,
  opts: { mode?: EditMode } = {},
): Promise<CreatorProfile> {
  const mode = opts.mode ?? "onboarding";
  return db.transaction(async (tx) => {
    const existing = await findProfile(tx, userId);
    if (mode === "onboarding" && existing && existing.profileStatus !== "draft")
      throw new OnboardingError("already_completed");
    if (mode === "passport" && existing?.profileStatus !== "completed") throw new OnboardingError("step_locked");

    // Provenance: the legal name counts as verified only if it matches the consented identity lookup.
    const prefill = await getIdentityPrefill(tx, userId);
    const values = {
      legalName: input.legalName,
      legalNameSource:
        prefill && namesMatch(prefill.verifiedName, input.legalName)
          ? ("verified_lookup" as const)
          : ("self_declared" as const),
      displayName: input.displayName,
      city: input.city,
      state: input.state,
      languages: input.languages,
      languagesOther: input.languagesOther,
    };

    const [profile] = existing
      ? await tx.update(creatorProfiles).set(values).where(eq(creatorProfiles.id, existing.id)).returning()
      : await tx
          .insert(creatorProfiles)
          .values({ ...values, userId, lastCompletedStep: "about" })
          .onConflictDoUpdate({ target: creatorProfiles.userId, set: values })
          .returning();
    if (!profile) throw new Error("profile upsert returned no row");

    await auditStep(tx, userId, profile.id, "about", mode);
    return profile;
  });
}

// --- Step 3: Creator profile -----------------------------------------------------

export async function saveProfileStep(
  db: Database,
  userId: string,
  input: ProfileStepInput,
  now = new Date(),
  opts: { mode?: EditMode } = {},
): Promise<CreatorProfile> {
  const mode = opts.mode ?? "onboarding";
  if (input.creatorSince && isFutureMonth(input.creatorSince, now)) {
    throw new OnboardingError("future_month", "creatorSince", "Creating since can't be in the future.");
  }

  return db.transaction(async (tx) => {
    const profile = await findProfile(tx, userId);
    assertEditable(profile, "profile", mode);

    const chosen = [input.creatorCategory, ...input.additionalCategories];
    const categories = await activeCodes(tx, creatorCategories, chosen);
    if (chosen.some((c) => !categories.has(c))) {
      throw new OnboardingError("unknown_category", "categories", "Choose categories from the list.");
    }
    const platformCodes = input.platforms.map((p) => p.code);
    const platforms = await activeCodes(tx, socialPlatforms, platformCodes);
    if (platformCodes.some((c) => !platforms.has(c))) {
      throw new OnboardingError("unknown_platform", "platforms", "Choose platforms from the list.");
    }

    const [updated] = await tx
      .update(creatorProfiles)
      .set({
        primaryCreatorHandle: input.primaryCreatorHandle,
        creatorCategory: input.creatorCategory,
        creatorSince: input.creatorSince ? monthToDate(input.creatorSince) : null,
        lastCompletedStep: progressFor(mode, profile.lastCompletedStep, "profile"),
      })
      .where(eq(creatorProfiles.id, profile.id))
      .returning();
    if (!updated) throw new Error("profile update returned no row");

    await tx.delete(creatorAdditionalCategories).where(eq(creatorAdditionalCategories.creatorId, profile.id));
    if (input.additionalCategories.length) {
      await tx
        .insert(creatorAdditionalCategories)
        .values(input.additionalCategories.map((categoryCode) => ({ creatorId: profile.id, categoryCode })));
    }

    // Declared platforms are reconciled in place (rows keep their id, so any
    // history from an earlier connection stays attached). Verified connections
    // only get their declared handle refreshed; they are never removed here.
    const active = await tx
      .select({
        id: creatorSocialAccounts.id,
        platform: creatorSocialAccounts.platform,
        status: creatorSocialAccounts.connectionStatus,
        provider: creatorSocialAccounts.provider,
        isPrimary: creatorSocialAccounts.isPrimary,
      })
      .from(creatorSocialAccounts)
      .where(
        and(
          eq(creatorSocialAccounts.creatorId, profile.id),
          ne(creatorSocialAccounts.connectionStatus, "disconnected"),
        ),
      );
    const submitted = new Set(input.platforms.map((p) => p.code));
    const removed = active.filter(
      (a) => a.status === "declared" && a.provider === SELF_DECLARED_PROVIDER && !submitted.has(a.platform),
    );
    if (removed.length) {
      await tx.delete(creatorSocialAccounts).where(
        inArray(
          creatorSocialAccounts.id,
          removed.map((r) => r.id),
        ),
      );
    }
    for (const p of input.platforms) {
      const rows = active.filter((a) => a.platform === p.code);
      // The declaration belongs to the creator's primary account on the platform (extra accounts have none).
      const connectedRow =
        rows.find((a) => a.status !== "declared" && a.isPrimary) ?? rows.find((a) => a.status !== "declared");
      const declaredRow = rows.find((a) => a.status === "declared");
      if (connectedRow) {
        await tx
          .update(creatorSocialAccounts)
          .set({ declaredHandle: p.handle })
          .where(eq(creatorSocialAccounts.id, connectedRow.id));
      } else if (declaredRow) {
        await tx
          .update(creatorSocialAccounts)
          .set({ handle: p.handle, declaredHandle: p.handle })
          .where(eq(creatorSocialAccounts.id, declaredRow.id));
      } else {
        await tx.insert(creatorSocialAccounts).values({
          creatorId: profile.id,
          platform: p.code,
          handle: p.handle,
          declaredHandle: p.handle,
          connectionStatus: "declared",
          provider: SELF_DECLARED_PROVIDER,
          isPrimary: true,
        });
      }
    }

    await auditStep(tx, userId, profile.id, "profile", mode);
    return updated;
  });
}

// --- Step 4: Business status ------------------------------------------------------

/**
 * Saves the declared legal form and GST status. A declared GSTIN is verified
 * against the registry first: it must exist and not be cancelled, and its
 * constitution must be one the pilot supports. The declaration is the
 * creator's; the registry check only rejects contradictory data.
 */
export async function saveBusinessStep(
  db: Database,
  userId: string,
  input: BusinessStepInput,
  deps: { taxRegistry?: TaxRegistrationProvider; now?: Date; mode?: EditMode } = {},
): Promise<CreatorProfile> {
  const mode = deps.mode ?? "onboarding";
  // Defence in depth: the schema already rejects these.
  if (!isPilotSupportedLegalForm(input.legalForm)) {
    throw new OnboardingError("unsupported_legal_form", "legalForm", "Not supported in the current pilot.");
  }
  const gst = normaliseGstDeclaration(input.gstStatus, input.gstin);
  const now = deps.now ?? new Date();
  const taxRegistry =
    deps.taxRegistry ??
    (await resolveProvider({ db, production: process.env.APP_ENV === "production" }, "tax_registration")).provider;

  // Verify outside the transaction (network call), then write atomically.
  let verification: Awaited<ReturnType<TaxRegistrationProvider["verifyGstin"]>> | null = null;
  if (gst.gstin) {
    const profileBefore = await findProfile(db, userId);
    assertEditable(profileBefore, "business", mode);
    verification = await callProvider(
      db,
      { userId, provider: taxRegistry.descriptor, operation: "verify_gstin" },
      () => taxRegistry.verifyGstin({ gstin: gst.gstin! }),
      (r) => ({ outcome: r.registration ? "success" : "not_found", reference: r.reference }),
    );
    const reg = verification.registration;
    if (!reg) {
      throw new OnboardingError(
        "gstin_not_active",
        "gstin",
        "We couldn't find this GSTIN in the GST registry. Check it, or choose another option.",
      );
    }
    if (reg.status === "cancelled") {
      throw new OnboardingError(
        "gstin_not_active",
        "gstin",
        "This GSTIN is cancelled. If you're no longer registered, choose “Not registered for GST”.",
      );
    }
    const registryForm = constitutionToLegalForm(reg.constitution);
    if (registryForm && !isPilotSupportedLegalForm(registryForm)) {
      throw new OnboardingError(
        "unsupported_legal_form",
        "legalForm",
        `This GSTIN is registered to a ${reg.constitution}, which isn't supported in the current pilot.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const profile = await findProfile(tx, userId);
    assertEditable(profile, "business", mode);

    if (gst.gstin && verification?.registration) {
      await storeGstRegistration(tx, {
        creatorId: profile.id,
        registration: verification.registration,
        source: await gstinSourceFor(tx, userId, gst.gstin),
        provider: taxRegistry.descriptor.key,
        reference: verification.reference,
        now,
      });
    }

    const [updated] = await tx
      .update(creatorProfiles)
      .set({
        legalForm: input.legalForm,
        gstStatus: gst.gstStatus,
        gstin: gst.gstin,
        lastCompletedStep: progressFor(mode, profile.lastCompletedStep, "business"),
      })
      .where(eq(creatorProfiles.id, profile.id))
      .returning();
    if (!updated) throw new Error("profile update returned no row");

    // Record that a declaration was made — never the GSTIN itself.
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: userId,
      eventType: "onboarding.business_status_declared",
      entityType: "creator_profile",
      entityId: profile.id,
      metadata: { legal_form: input.legalForm, gst_status: gst.gstStatus, gst_id_provided: gst.gstin !== null },
    });
    await auditStep(tx, userId, profile.id, "business", mode);
    return updated;
  });
}

// --- Step 5: Professional interests ------------------------------------------------

export async function saveInterestsStep(
  db: Database,
  userId: string,
  input: InterestsStepInput,
  opts: { mode?: EditMode } = {},
): Promise<void> {
  const mode = opts.mode ?? "onboarding";
  await db.transaction(async (tx) => {
    const profile = await findProfile(tx, userId);
    assertEditable(profile, "interests", mode);

    const requested = [...new Set([...input.preferredCategories, ...input.brandInterests])];
    const known = await activeCodes(tx, creatorCategories, requested);
    const unknown = requested.find((c) => !known.has(c));
    if (unknown)
      throw new OnboardingError("unknown_category", "preferredCategories", "Choose categories from the list.");

    const values = {
      prInterest: input.prInterest,
      // PR categories only make sense when the creator wants PR.
      preferredCategories: input.prInterest ? input.preferredCategories : [],
      brandInterests: input.brandInterests,
      travelInterest: input.travelInterest,
    };
    await tx
      .insert(creatorPreferences)
      .values({ creatorId: profile.id, ...values })
      .onConflictDoUpdate({ target: creatorPreferences.creatorId, set: values });

    await tx
      .update(creatorProfiles)
      .set({ lastCompletedStep: progressFor(mode, profile.lastCompletedStep, "interests") })
      .where(eq(creatorProfiles.id, profile.id));

    await auditStep(tx, userId, profile.id, "interests", mode);
  });
}

// --- Step 6: Consent + completion ---------------------------------------------------

/**
 * Grants the versioned Creator Profile consent and completes onboarding,
 * atomically. Completion is impossible without a valid consent receipt.
 */
export async function completeOnboarding(
  db: Database,
  userId: string,
  input: { consentDefinitionId: string; now?: Date },
): Promise<CreatorProfile> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const profile = await findProfile(tx, userId);
    assertEditable(profile, "consent");

    await grantConsent(tx, {
      userId,
      key: CONSENT_KEYS.creatorProfile,
      consentDefinitionId: input.consentDefinitionId,
      source: "onboarding",
      metadata: { surface: "onboarding" },
      now,
    });
    if (!(await hasValidConsent(tx, userId, CONSENT_KEYS.creatorProfile, now))) {
      throw new OnboardingError("consent_required");
    }

    const [completed] = await tx
      .update(creatorProfiles)
      .set({ lastCompletedStep: "consent", profileStatus: "completed", completedAt: now })
      .where(eq(creatorProfiles.id, profile.id))
      .returning();
    if (!completed) throw new Error("profile completion returned no row");

    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: userId,
      eventType: "creator_profile.completed",
      entityType: "creator_profile",
      entityId: profile.id,
      metadata: { category: completed.creatorCategory, gst_status: completed.gstStatus },
    });
    await recordEvent(tx, {
      event: "creator_profile_completed",
      userId,
      props: { category: completed.creatorCategory ?? null },
      now,
    });
    // Membership milestones (welcome, verified mobile) — simulated Creator Points.
    await syncMilestonePoints(tx, { userId, now });
    return completed;
  });
}
