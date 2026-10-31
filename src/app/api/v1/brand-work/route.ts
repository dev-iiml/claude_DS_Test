import { z } from "zod";

import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { createRecord, getRecordForCreator, listRecordsForCreator, portfolioForCreator } from "@/modules/brand-work";
import { recordInputSchema } from "@/modules/brand-work/schemas";

import { toApiError } from "../_lib/errors";
import { ApiError, json, rateLimited, readJson, route } from "../_lib/http";
import { fieldErrorsFromZod } from "@/lib/forms";
import { requireApiMember } from "../access/_member";

/** The creator's brand-work records (own only, neutral wording) and their non-private brand portfolio. */
export const GET = route("brand_work.list", async (request) => {
  const { user, creatorId } = await requireApiMember(request);
  const db = getDb();
  const [records, portfolio] = await Promise.all([
    listRecordsForCreator(db, user.userId),
    portfolioForCreator(db, creatorId),
  ]);
  return json({ records, portfolio });
});

/**
 * Add a record. If the `brand_work_records` consent isn't given yet, send the active definition id with
 * `agree: true` — it's granted with the record, or not at all.
 */
export const POST = route("brand_work.create", async (request) => {
  const { user } = await requireApiMember(request);
  const body = await readJson(
    request,
    z
      .object({ record: z.unknown(), consentDefinitionId: z.uuid().optional(), agree: z.literal(true).optional() })
      .refine((b) => !b.consentDefinitionId || b.agree === true, {
        path: ["agree"],
        message: "Send agree: true with the consent definition.",
      }),
  );
  const parsed = recordInputSchema.safeParse(body.record);
  if (!parsed.success)
    throw new ApiError(
      422,
      "validation_failed",
      "Please check the highlighted fields.",
      fieldErrorsFromZod(parsed.error),
    );
  const limited = await rateLimit("brand_work.create", user.userId);
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  try {
    const db = getDb();
    const id = await createRecord(db, {
      userId: user.userId,
      values: parsed.data,
      consentDefinitionId: body.consentDefinitionId ?? null,
      source: "api",
    });
    return json(await getRecordForCreator(db, user.userId, id), 201);
  } catch (error) {
    toApiError(error);
  }
});
