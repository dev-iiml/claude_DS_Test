import { z } from "zod";

import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { CODE_EXPIRY_DAYS, CODE_MAX_USES_LIMIT, type CodeExpiryDays } from "@/modules/public-passport/domain";
import { createAccessCode, listAccessCodes } from "@/modules/public-passport/codes-service";

import { requireApiMember } from "../../../access/_member";
import { toApiError } from "../../../_lib/errors";
import { json, rateLimited, readJson, route } from "../../../_lib/http";

/** Access codes: list (never the code itself — only a 4-character hint) and create (the code is returned once). */
export const GET = route("passport_codes.list", async (request) => {
  const { user } = await requireApiMember(request);
  try {
    return json({ codes: await listAccessCodes(getDb(), user.userId) });
  } catch (error) {
    toApiError(error);
  }
});

const createSchema = z
  .object({
    label: z.string().max(60),
    expiresInDays: z
      .number()
      .refine((d): d is CodeExpiryDays => (CODE_EXPIRY_DAYS as readonly number[]).includes(d), "Use 7, 30 or 90."),
    maxUses: z.number().int().min(1).max(CODE_MAX_USES_LIMIT).nullable().optional(),
  })
  .strict();

export const POST = route("passport_codes.create", async (request) => {
  const { user } = await requireApiMember(request);
  const body = await readJson(request, createSchema);
  const limited = await rateLimit("passport.code_create", user.userId);
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  try {
    const c = await createAccessCode(getDb(), {
      userId: user.userId,
      label: body.label,
      expiresInDays: body.expiresInDays as CodeExpiryDays,
      maxUses: body.maxUses ?? null,
    });
    // Shown once: CreatorCo keeps only a hash.
    return json({ id: c.id, code: c.display, expiresAt: c.expiresAt.toISOString() }, 201);
  } catch (error) {
    toApiError(error);
  }
});
