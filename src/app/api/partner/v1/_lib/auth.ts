import "server-only";

import type { NextRequest } from "next/server";

import { ApiError } from "@/app/api/v1/_lib/http";
import { getDb } from "@/db";
import { authenticateApiKey, type AuthenticatedPartner, type PartnerScope } from "@/modules/partners";

/**
 * Partner API authentication (Stage 12b): `Authorization: Bearer cck_…` only.
 * Cookies and creator sessions are never accepted here, and creator API
 * tokens are never accepted as partner keys. Failures are uniform (no hint
 * whether a key exists, expired or was revoked).
 */
export async function requirePartner(request: NextRequest, scope: PartnerScope | null): Promise<AuthenticatedPartner> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (cck_[A-Za-z0-9_-]{20,80})$/.exec(header);
  const partner = match ? await authenticateApiKey(getDb(), match[1]!) : null;
  if (!partner) throw new ApiError(401, "unauthenticated", "A valid partner API key is required.");
  if (scope && !partner.scopes.includes(scope))
    throw new ApiError(403, "insufficient_scope", `This key doesn't have the ${scope} scope.`);
  return partner;
}
