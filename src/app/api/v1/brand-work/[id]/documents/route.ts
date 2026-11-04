import { z } from "zod";

import { handleBrandWorkUpload } from "@/app/_lib/brand-work-uploads";
import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { getRecordForCreator } from "@/modules/brand-work";

import { toApiError } from "../../../_lib/errors";
import { ApiError, json, rateLimited, route } from "../../../_lib/http";
import { requireApiMember } from "../../../access/_member";

/**
 * Upload one document: `multipart/form-data` with `kind` (invoice | purchase_order | agreement |
 * remittance_advice) and `file` (PDF, JPEG or PNG, ≤ 10 MB; checked by magic bytes). The filename is ignored.
 */
export const POST = route<RouteContext<"/api/v1/brand-work/[id]/documents">>(
  "brand_work.upload",
  async (request, ctx) => {
    const { user } = await requireApiMember(request);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Record not found.");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data"))
      throw new ApiError(415, "unsupported_media_type", "Send multipart/form-data with `kind` and `file`.");
    const limited = await rateLimit("brand_work.upload", user.userId);
    if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
    try {
      const result = await handleBrandWorkUpload(request, { userId: user.userId, recordId: id });
      return json(
        {
          documentId: result.documentId,
          reused: result.reused,
          record: await getRecordForCreator(getDb(), user.userId, id),
        },
        201,
      );
    } catch (error) {
      toApiError(error);
    }
  },
);
