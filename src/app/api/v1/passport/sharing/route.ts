import { z } from "zod";

import { getDb } from "@/db";
import {
  FIELD_RULES,
  FIELD_TIERS,
  PASSPORT_FIELDS,
  UNLOCK_AUDIENCES,
  type PassportField,
} from "@/modules/public-passport/domain";
import {
  getSharingState,
  publishPassport,
  setSlug,
  setUnlockAudience,
  unpublishOwnPassport,
  updateBio,
  updateFieldTiers,
  updateToggles,
} from "@/modules/public-passport/settings-service";

import { requireApiMember } from "../../access/_member";
import { toApiError } from "../../_lib/errors";
import { json, readJson, route } from "../../_lib/http";

/**
 * Passport → Sharing (Stage 19). GET: the creator's settings. PATCH: change
 * any of them; publishing / unlocking need their own consent (send the active
 * definition id with `agree: true` the first time).
 */

async function view(userId: string) {
  const s = await getSharingState(getDb(), userId);
  return {
    published: s.published,
    status: s.passport.status,
    slug: s.passport.slug,
    suggestedSlug: s.suggestedSlug,
    url: s.published && s.passport.slug ? `/p/${s.passport.slug}` : null,
    bio: s.passport.bio,
    hasPhoto: Boolean(s.passport.photoKey && s.passport.photoScan === "clean"),
    fields: PASSPORT_FIELDS.map((f) => ({
      field: f,
      label: FIELD_RULES[f].label,
      allowed: FIELD_RULES[f].allowed,
      tier: s.tiers[f],
    })),
    indexable: s.passport.indexable,
    includePrivateInTotals: s.passport.includePrivateInTotals,
    audience: s.passport.audience,
    discoverable: s.passport.discoverable,
    canPublish: s.canPublish,
    consents: s.consents,
  };
}

export const GET = route("passport_sharing.get", async (request) => {
  const { user } = await requireApiMember(request);
  try {
    return json(await view(user.userId));
  } catch (error) {
    toApiError(error);
  }
});

const consent = { consentDefinitionId: z.uuid().optional(), agree: z.literal(true).optional() };
const patchSchema = z
  .object({
    publish: z.boolean().optional(),
    slug: z.string().max(40).optional(),
    bio: z.string().max(400).nullable().optional(),
    fields: z.record(z.string(), z.enum(FIELD_TIERS)).optional(),
    indexable: z.boolean().optional(),
    includePrivateInTotals: z.boolean().optional(),
    audience: z.enum(UNLOCK_AUDIENCES).optional(),
    discoverable: z.boolean().optional(),
    publicPassportConsent: z.object(consent).optional(),
    passportUnlockConsent: z.object(consent).optional(),
  })
  .strict();

const agreed = (c: { consentDefinitionId?: string; agree?: true } | undefined) =>
  c?.agree ? (c.consentDefinitionId ?? null) : null;

export const PATCH = route("passport_sharing.update", async (request) => {
  const { user } = await requireApiMember(request);
  const body = await readJson(request, patchSchema);
  const db = getDb();
  try {
    if (body.publish === false) await unpublishOwnPassport(db, user.userId);
    if (body.slug !== undefined && body.publish !== true) await setSlug(db, { userId: user.userId, slug: body.slug });
    if (body.bio !== undefined) await updateBio(db, { userId: user.userId, bio: body.bio });
    if (body.fields)
      await updateFieldTiers(db, {
        userId: user.userId,
        tiers: body.fields as Partial<Record<PassportField, (typeof FIELD_TIERS)[number]>>,
      });
    if (body.indexable !== undefined || body.includePrivateInTotals !== undefined)
      await updateToggles(db, {
        userId: user.userId,
        indexable: body.indexable,
        includePrivateInTotals: body.includePrivateInTotals,
      });
    if (body.audience !== undefined || body.discoverable !== undefined) {
      const current = await getSharingState(db, user.userId);
      await setUnlockAudience(db, {
        userId: user.userId,
        audience: body.audience ?? (current.passport.audience as (typeof UNLOCK_AUDIENCES)[number]),
        discoverable: body.discoverable ?? current.passport.discoverable,
        consentDefinitionId: agreed(body.passportUnlockConsent),
        source: "api",
      });
    }
    if (body.publish === true)
      await publishPassport(db, {
        userId: user.userId,
        slug: body.slug ?? null,
        consentDefinitionId: agreed(body.publicPassportConsent),
        source: "api",
      });
    return json(await view(user.userId));
  } catch (error) {
    toApiError(error);
  }
});
