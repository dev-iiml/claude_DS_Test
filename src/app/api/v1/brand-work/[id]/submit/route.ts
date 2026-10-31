import { z } from "zod";

import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { getRecordForCreator, submitRecord } from "@/modules/brand-work";

import { toApiError } from "../../../_lib/errors";
import { ApiError, json, rateLimited, route } from "../../../_lib/http";
import { requireApiMember } from "../../../access/_member";

/** Send a draft (or a record that needed a change) for verification. */
export const POST = route<RouteContext<"/api/v1/brand-work/[id]/submit">>("brand_work.submit", async (request, ctx) => {
  const { user } = await requireApiMember(request);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Record not found.");
  const limited = await rateLimit("brand_work.submit", user.userId);
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  try {
    const db = getDb();
    await submitRecord(db, { userId: user.userId, recordId: id });
    return json(await getRecordForCreator(db, user.userId, id));
  } catch (error) {
    toApiError(error);
  }
});
