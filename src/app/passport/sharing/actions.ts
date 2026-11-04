"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { formError, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import {
  CODE_EXPIRY_DAYS,
  FIELD_RULES,
  PASSPORT_FIELDS,
  UNLOCK_AUDIENCES,
  type CodeExpiryDays,
  type FieldTier,
  type PassportField,
} from "@/modules/public-passport/domain";
import { PassportError } from "@/modules/public-passport/errors";
import { verifiedOrgForOpportunity } from "@/modules/brand-orgs/access-service";
import { createAccessCode, revokeAccessCode } from "@/modules/public-passport/codes-service";
import { removePassportPhoto } from "@/modules/public-passport/photo-service";
import {
  publishPassport,
  setSlug,
  setUnlockAudience,
  unpublishOwnPassport,
  updateBio,
  updateFieldTiers,
  updateToggles,
} from "@/modules/public-passport/settings-service";

import { requireMember } from "../../_lib/member";

/**
 * Passport → Sharing (Stage 19). Thin: authorise, read, call the
 * public-passport service, report. Free text the service rejects (bio, slug,
 * code label) is never echoed back into form state.
 */

const SHARING = "/passport/sharing";

function failure(error: unknown, fallback: string, values?: FormState["values"]): FormState {
  if (error instanceof PassportError) {
    const fieldErrors = error.code === "consent_required" ? { agree: [error.message] } : undefined;
    return formError(error.message !== error.code ? error.message : fallback, { fieldErrors, values });
  }
  logger.error("passport_sharing.action_failed", describeError(error));
  return formError(fallback, { values });
}

/** Keep the typed link on the form after an error — unless it was refused for its content. */
const echoSlug = (error: unknown, slug: string) =>
  error instanceof PassportError && error.code === "invalid" ? undefined : { slug };

const agreedDefinition = (form: FormData) =>
  readText(form, "agree") === "on" ? (readText(form, "consentDefinitionId") ?? null) : null;

// ── Publish / link ──────────────────────────────────────────────────────────

export async function publishAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const slug = (readText(form, "slug") ?? "").trim().toLowerCase();
  try {
    await publishPassport(getDb(), {
      userId: user.userId,
      slug: slug || null,
      consentDefinitionId: agreedDefinition(form),
      source: "settings",
    });
  } catch (error) {
    return failure(error, "We couldn't publish your Passport.", echoSlug(error, slug));
  }
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=published`);
}

export async function unpublishAction(): Promise<void> {
  const { user } = await requireMember();
  await unpublishOwnPassport(getDb(), user.userId);
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=unpublished`);
}

export async function changeSlugAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const slug = (readText(form, "slug") ?? "").trim().toLowerCase();
  try {
    await setSlug(getDb(), { userId: user.userId, slug });
  } catch (error) {
    return failure(error, "We couldn't change your link.", echoSlug(error, slug));
  }
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=link`);
}

// ── Profile (bio, photo) ────────────────────────────────────────────────────

export async function bioAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  try {
    await updateBio(getDb(), { userId: user.userId, bio: readText(form, "bio") ?? null });
  } catch (error) {
    // The bio isn't echoed when it was refused (it may hold an identifier).
    return failure(error, "We couldn't save your bio.");
  }
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=bio`);
}

export async function removePhotoAction(): Promise<void> {
  const { user } = await requireMember();
  await removePassportPhoto(getDb(), user.userId);
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=photo_removed`);
}

// ── What's shown ────────────────────────────────────────────────────────────

export async function fieldsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const tiers: Partial<Record<PassportField, FieldTier>> = {};
  for (const field of PASSPORT_FIELDS) {
    const v = readText(form, `tier.${field}`);
    if (v === undefined) continue;
    if (!(FIELD_RULES[field].allowed as readonly string[]).includes(v))
      return formError("That visibility isn't available for one of the fields.");
    tiers[field] = v as FieldTier;
  }
  try {
    await updateFieldTiers(getDb(), { userId: user.userId, tiers });
  } catch (error) {
    return failure(error, "We couldn't save what's shown.");
  }
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=fields#fields`);
}

export async function optionsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  try {
    await updateToggles(getDb(), {
      userId: user.userId,
      indexable: readText(form, "indexable") === "on",
      includePrivateInTotals: readText(form, "includePrivateInTotals") === "on",
    });
  } catch (error) {
    return failure(error, "We couldn't save these options.");
  }
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=options#options`);
}

// ── Who can unlock ──────────────────────────────────────────────────────────

const audienceSchema = z.enum(UNLOCK_AUDIENCES);

export async function audienceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireMember();
  const audience = audienceSchema.safeParse(readText(form, "audience"));
  if (!audience.success) return formError("Choose who can unlock your Passport.");
  const discoverable = readText(form, "discoverable") === "on";
  const values = { audience: audience.data, discoverable };
  try {
    await setUnlockAudience(getDb(), {
      userId: user.userId,
      audience: audience.data,
      discoverable,
      consentDefinitionId: agreedDefinition(form),
      source: "settings",
    });
  } catch (error) {
    return failure(error, "We couldn't save who can unlock.", values);
  }
  revalidatePath(SHARING);
  redirect(`${SHARING}?notice=audience#unlock`);
}

// ── Access codes ────────────────────────────────────────────────────────────

/** The new code is returned once in form state and never stored in the clear. */
export type CodeFormState = FormState & { created?: { display: string; label: string; expiresAt: string } };

const codeSchema = z.object({
  label: z.string(),
  days: z.coerce.number().refine((d): d is CodeExpiryDays => (CODE_EXPIRY_DAYS as readonly number[]).includes(d)),
  maxUses: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Use a whole number, or leave it empty."),
});

export async function createCodeAction(_prev: CodeFormState, form: FormData): Promise<CodeFormState> {
  const { user } = await requireMember();
  const parsed = codeSchema.safeParse({
    label: readText(form, "label") ?? "",
    days: readText(form, "days") ?? "",
    maxUses: readText(form, "maxUses") ?? "",
  });
  const values = { days: readText(form, "days") ?? "30", maxUses: readText(form, "maxUses") ?? "" };
  if (!parsed.success)
    return formError("Please check the highlighted fields.", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), [i.message || "Check this field."]]),
      ),
      values,
    });
  const limited = await rateLimit("passport.code_create", user.userId);
  if (!limited.ok) return formError("You've created a lot of codes today. Please try again tomorrow.", { values });
  try {
    const created = await createAccessCode(getDb(), {
      userId: user.userId,
      label: parsed.data.label,
      expiresInDays: parsed.data.days as CodeExpiryDays,
      maxUses: parsed.data.maxUses,
    });
    revalidatePath(`${SHARING}/codes`);
    return {
      status: "idle",
      created: {
        display: created.display,
        label: parsed.data.label.trim(),
        expiresAt: created.expiresAt.toISOString(),
      },
    };
  } catch (error) {
    return failure(error, "We couldn't create a code.", values);
  }
}

const idSchema = z.uuid();

export async function revokeCodeAction(form: FormData): Promise<void> {
  const { user } = await requireMember();
  const id = idSchema.safeParse(readText(form, "codeId"));
  if (id.success) {
    try {
      await revokeAccessCode(getDb(), { userId: user.userId, codeId: id.data });
    } catch (error) {
      if (!(error instanceof PassportError)) logger.error("passport_sharing.revoke_failed", describeError(error));
      redirect(`${SHARING}/codes?notice=revoke_failed`);
    }
  }
  revalidatePath(`${SHARING}/codes`);
  redirect(`${SHARING}/codes?notice=revoked`);
}

/**
 * The Access-flow prompt: a one-off code (7 days) that only signed-in members
 * of the opportunity brand's verified organisation can use. Shown once.
 */
export async function shareWithOrgAction(_prev: CodeFormState, form: FormData): Promise<CodeFormState> {
  const { user } = await requireMember();
  const opportunityId = idSchema.safeParse(readText(form, "opportunityId"));
  if (!opportunityId.success) return formError("We couldn't create a code.");
  const db = getDb();
  const org = await verifiedOrgForOpportunity(db, opportunityId.data);
  if (!org) return formError("This brand isn't a verified organisation on CreatorCo yet.");
  const limited = await rateLimit("passport.code_create", user.userId);
  if (!limited.ok) return formError("You've created a lot of codes today. Please try again tomorrow.");
  const label = `For ${org.name}`.slice(0, 60);
  try {
    const created = await createAccessCode(db, { userId: user.userId, label, expiresInDays: 7, orgId: org.id });
    revalidatePath(`${SHARING}/codes`);
    return { status: "idle", created: { display: created.display, label, expiresAt: created.expiresAt.toISOString() } };
  } catch (error) {
    return failure(error, "We couldn't create a code.");
  }
}
