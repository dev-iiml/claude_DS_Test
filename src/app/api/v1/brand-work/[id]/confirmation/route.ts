import { z } from "zod";

import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import {
  bankMatchAvailable,
  chooseConfirmation,
  getRecordForCreator,
  refreshGraphForRecord,
} from "@/modules/brand-work";
import { CONFIRMATION_METHODS } from "@/modules/brand-work/domain";

import { toApiError } from "../../../_lib/errors";
import { ApiError, json, rateLimited, readJson, route } from "../../../_lib/http";
import { requireApiMember } from "../../../access/_member";

type Ctx = RouteContext<"/api/v1/brand-work/[id]/confirmation">;

/** Which confirmation methods are offered now (all equal; `aa_match` only when the /ops switch is on). */
export const GET = route<Ctx>("brand_work.confirmation_options", async (request) => {
  await requireApiMember(request);
  const bank = await bankMatchAvailable(getDb());
  return json({
    methods: CONFIRMATION_METHODS.filter((m) => m !== "aa_match" || bank),
    samePointsForEveryMethod: true,
  });
});

/**
 * Choose how a verified record's payment is confirmed. `aa_match` needs the optional `brand_payment_match`
 * consent (send its definition id with `agree: true` if not yet given); the result is `seen | not_seen | unknown`.
 */
export const POST = route<Ctx>("brand_work.confirmation", async (request, ctx) => {
  const { user } = await requireApiMember(request);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Record not found.");
  const body = await readJson(
    request,
    z
      .object({
        method: z.enum(CONFIRMATION_METHODS),
        consentDefinitionId: z.uuid().optional(),
        agree: z.literal(true).optional(),
      })
      .refine((b) => !b.consentDefinitionId || b.agree === true, {
        path: ["agree"],
        message: "Send agree: true with the consent definition.",
      }),
  );
  if (body.method === "aa_match") {
    const limited = await rateLimit("brand_work.payment_check", user.userId);
    if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  }
  try {
    const db = getDb();
    const result = await chooseConfirmation(db, {
      userId: user.userId,
      recordId: id,
      method: body.method,
      consentDefinitionId: body.consentDefinitionId ?? null,
      source: "api",
    });
    if (result.match === "seen") await refreshGraphForRecord(db, id);
    return json({ ...result, record: await getRecordForCreator(db, user.userId, id) });
  } catch (error) {
    toApiError(error);
  }
});
