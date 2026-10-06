import type { NextRequest } from "next/server";

import { json, route } from "@/app/api/v1/_lib/http";

import { requirePartner } from "../_lib/auth";

/** Connectivity check for a partner's integration: who the key belongs to and what it may do (any scope). */
export const GET = route("partner.ping", async (request: NextRequest) => {
  const auth = await requirePartner(request, null);
  return json({
    partner: auth.partner.key,
    environment: auth.partner.environment,
    key: auth.keyPrefix,
    scopes: auth.scopes,
  });
});
