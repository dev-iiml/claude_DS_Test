import type { NextRequest } from "next/server";

import { ApiError, json, route } from "@/app/api/v1/_lib/http";
import { getDb } from "@/db";
import { listPartnerEvents } from "@/modules/partners";

import { requirePartner } from "../_lib/auth";

/**
 * The partner's event feed: the same thin events as the webhooks, oldest first
 * after `?after=<seq>`, so a partner can recover anything a webhook missed.
 */
export const GET = route("partner.events", async (request: NextRequest) => {
  const auth = await requirePartner(request, "events:read");
  const params = request.nextUrl.searchParams;
  const after = params.get("after") ?? "0";
  const limit = params.get("limit") ?? "50";
  if (!/^\d{1,15}$/.test(after) || !/^\d{1,3}$/.test(limit))
    throw new ApiError(422, "validation_failed", "`after` and `limit` must be whole numbers.");
  return json(
    await listPartnerEvents(getDb(), { partnerId: auth.partner.id, after: Number(after), limit: Number(limit) }),
  );
});
