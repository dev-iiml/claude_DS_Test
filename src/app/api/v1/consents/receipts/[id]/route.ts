import { z } from "zod";

import { getDb } from "@/db";
import { getReceipt } from "@/modules/privacy";

import { requireApiCreator } from "../../../_lib/auth";
import { ApiError, json, route } from "../../../_lib/http";

/** One receipt with the exact text agreed to and its SHA-256 fingerprint. Owner only. */
export const GET = route<RouteContext<"/api/v1/consents/receipts/[id]">>("consents.receipt", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const { id } = await ctx.params;
  const receipt = z.uuid().safeParse(id).success
    ? await getReceipt(getDb(), { userId: user.userId, receiptId: id })
    : null;
  if (!receipt) throw new ApiError(404, "not_found", "Receipt not found.");
  return json(receipt);
});
