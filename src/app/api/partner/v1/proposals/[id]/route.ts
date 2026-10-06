import type { NextRequest } from "next/server";

import { ApiError, json, route } from "@/app/api/v1/_lib/http";
import { getDb } from "@/db";
import { getPartnerProposal } from "@/modules/lending";

import { requirePartner } from "../../_lib/auth";

/** One proposal: the frozen payload, its decisions and any CreatorCo queries. 404 unless it was sent to this partner. */
export const GET = route(
  "partner.proposals.get",
  async (request: NextRequest, ctx: RouteContext<"/api/partner/v1/proposals/[id]">) => {
    const auth = await requirePartner(request, "proposals:read");
    const { id } = await ctx.params;
    const proposal = /^[0-9a-f-]{36}$/i.test(id)
      ? await getPartnerProposal(getDb(), { lenderKey: auth.partner.lenderKey, proposalId: id, apiKeyId: auth.keyId })
      : null;
    if (!proposal) throw new ApiError(404, "not_found", "No such proposal for this partner.");
    return json(proposal);
  },
);
