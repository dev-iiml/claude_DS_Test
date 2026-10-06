import type { NextRequest } from "next/server";

import { ApiError, json, readJson, route } from "@/app/api/v1/_lib/http";
import { getDb } from "@/db";
import {
  IDEMPOTENCY_KEY_PATTERN,
  LendingError,
  canonicalDecision,
  partnerDecisionSchema,
  recordPartnerDecision,
} from "@/modules/lending";
import { requestHash } from "@/modules/partners/credentials";

import { requirePartner } from "../../../_lib/auth";

/**
 * The partner's decision on a proposal. Requires an `Idempotency-Key` header:
 * a retry with the same key and body returns the recorded decision (200); the
 * first time returns 201. A revision is accepted only while a CreatorCo query
 * is open.
 */
export const POST = route(
  "partner.decision",
  async (request: NextRequest, ctx: RouteContext<"/api/partner/v1/proposals/[id]/decision">) => {
    const auth = await requirePartner(request, "decisions:write");
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "not_found", "No such proposal for this partner.");
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
      throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header (8–100 characters).");
    const body = await readJson(request, partnerDecisionSchema);
    try {
      const { decision, replayed } = await recordPartnerDecision(getDb(), {
        lenderKey: auth.partner.lenderKey,
        apiKey: { id: auth.keyId, prefix: auth.keyPrefix },
        proposalId: id,
        idempotencyKey,
        requestHash: requestHash(canonicalDecision(body)),
        decision: {
          outcome: body.outcome,
          approvedExposure: body.approvedExposure ?? null,
          approvedTenorMonths: body.approvedTenorMonths ?? null,
          decisionBasis: body.decisionBasis ?? null,
          reasonCodes: body.reasonCodes,
          decidedAt: body.decidedAt ? new Date(body.decidedAt) : null,
          lenderReference: body.lenderReference ?? null,
          offer: body.offer ? { terms: body.offer.terms, expiresAt: new Date(body.offer.expiresAt) } : null,
        },
      });
      return json(
        {
          proposalId: id,
          revision: decision.revision,
          outcome: decision.outcome,
          approvedExposure: decision.approvedExposure,
          approvedTenorMonths: decision.approvedTenorMonths,
          receivedAt: decision.receivedAt.toISOString(),
        },
        replayed ? 200 : 201,
      );
    } catch (error) {
      if (error instanceof LendingError) {
        if (error.code === "not_found") throw new ApiError(404, "not_found", "No such proposal for this partner.");
        if (error.code === "conflict") throw new ApiError(409, "idempotency_conflict", error.message);
        if (error.code === "wrong_state") throw new ApiError(409, "already_decided", error.message);
        if (error.code === "invalid") throw new ApiError(422, "validation_failed", error.message);
      }
      throw error;
    }
  },
);
