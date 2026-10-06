import type { NextRequest } from "next/server";

import { ApiError, json, route } from "@/app/api/v1/_lib/http";
import { getDb } from "@/db";
import { PARTNER_PROPOSAL_STATUSES, listPartnerProposals, type PartnerProposalStatus } from "@/modules/lending";

import { requirePartner } from "../_lib/auth";

/** Proposals sent to this partner (ids and status only), oldest first. `?status=awaiting_decision` for the work queue. */
export const GET = route("partner.proposals.list", async (request: NextRequest) => {
  const auth = await requirePartner(request, "proposals:read");
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  if (status && !(PARTNER_PROPOSAL_STATUSES as readonly string[]).includes(status))
    throw new ApiError(422, "validation_failed", `status must be one of ${PARTNER_PROPOSAL_STATUSES.join(", ")}.`);
  const limit = params.get("limit");
  if (limit && !/^\d{1,3}$/.test(limit)) throw new ApiError(422, "validation_failed", "limit must be 1–100.");
  return json(
    await listPartnerProposals(getDb(), {
      lenderKey: auth.partner.lenderKey,
      status: (status as PartnerProposalStatus | null) ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit: limit ? Number(limit) : undefined,
    }),
  );
});
