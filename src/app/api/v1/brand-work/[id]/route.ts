import { z } from "zod";

import { fieldErrorsFromZod } from "@/lib/forms";
import { getDb } from "@/db";
import { deleteDraft, getRecordForCreator, updateRecord } from "@/modules/brand-work";
import { recordInputSchema } from "@/modules/brand-work/schemas";
import { enqueueJob } from "@/modules/jobs";

import { toApiError } from "../../_lib/errors";
import { ApiError, json, noContent, readJson, route } from "../../_lib/http";
import { requireApiMember } from "../../access/_member";

type Ctx = RouteContext<"/api/v1/brand-work/[id]">;

async function idOf(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Record not found.");
  return id;
}

export const GET = route<Ctx>("brand_work.get", async (request, ctx) => {
  const { user } = await requireApiMember(request);
  const record = await getRecordForCreator(getDb(), user.userId, await idOf(ctx));
  if (!record) throw new ApiError(404, "not_found", "Record not found.");
  return json(record);
});

/** Edit a draft or a record that needs a change. */
export const PATCH = route<Ctx>("brand_work.update", async (request, ctx) => {
  const { user } = await requireApiMember(request);
  const id = await idOf(ctx);
  const body = await readJson(request, z.object({ record: z.unknown() }));
  const parsed = recordInputSchema.safeParse(body.record);
  if (!parsed.success)
    throw new ApiError(
      422,
      "validation_failed",
      "Please check the highlighted fields.",
      fieldErrorsFromZod(parsed.error),
    );
  try {
    const db = getDb();
    await updateRecord(db, { userId: user.userId, recordId: id, values: parsed.data });
    return json(await getRecordForCreator(db, user.userId, id));
  } catch (error) {
    toApiError(error);
  }
});

/** Delete a draft (and its documents). */
export const DELETE = route<Ctx>("brand_work.delete", async (request, ctx) => {
  const { user } = await requireApiMember(request);
  try {
    const db = getDb();
    const keys = await deleteDraft(db, { userId: user.userId, recordId: await idOf(ctx) });
    for (const k of keys)
      await enqueueJob(db, { type: "brand_work_erase_documents", payload: { key: k.key, provider: k.provider } });
    return noContent();
  } catch (error) {
    toApiError(error);
  }
});
