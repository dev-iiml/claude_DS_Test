import { getDb } from "@/db";
import { CONSENT_KEYS, findValidReceipt, getActiveDefinition, type ConsentKey } from "@/modules/consent";

import { z } from "zod";

import { WITHDRAWAL_REASONS } from "@/modules/consent/domain";
import { PrivacyError, grantPurpose, purposeFor, withdrawPurpose } from "@/modules/privacy";
import { describeError, logger } from "@/lib/logger";
import { proposeForConfirmedChecks } from "@/modules/lending";

import { lendingDeps } from "@/app/_lib/lending";

import { requireApiCreator, requireApiUser } from "../../_lib/auth";
import { toApiError } from "../../_lib/errors";
import { ApiError, json, readJson, route } from "../../_lib/http";

const KEYS = new Set<string>(Object.values(CONSENT_KEYS));

/** The current consent text for a purpose, and whether this user holds it. */
export const GET = route<RouteContext<"/api/v1/consents/[key]">>("consents.get", async (request, ctx) => {
  const user = await requireApiUser(request);
  const { key } = await ctx.params;
  if (!KEYS.has(key)) throw new ApiError(404, "not_found", "Unknown consent purpose.");
  const db = getDb();
  const [definition, receipt] = await Promise.all([
    getActiveDefinition(db, key as ConsentKey),
    findValidReceipt(db, user.userId, key as ConsentKey),
  ]);
  if (!definition) throw new ApiError(404, "not_found", "No active version for this purpose.");
  return json({
    definition: {
      id: definition.id,
      key: definition.key,
      version: definition.version,
      title: definition.title,
      purpose: definition.purpose,
      body: definition.body,
      activeFrom: definition.activeFrom,
    },
    granted: Boolean(receipt),
    grantedAt: receipt?.grantedAt ?? null,
  });
});

async function purposeKey(ctx: RouteContext<"/api/v1/consents/[key]">) {
  const { key } = await ctx.params;
  if (!purposeFor(key)) throw new ApiError(404, "not_found", "Unknown consent purpose.");
  return key;
}

/** Gives (or re-gives) consent for a purpose. Re-giving the Creator Profile consent resumes membership. */
export const POST = route<RouteContext<"/api/v1/consents/[key]">>("consents.grant", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const key = await purposeKey(ctx);
  const { consentDefinitionId } = await readJson(
    request,
    z.object({ consentDefinitionId: z.uuid(), agree: z.literal(true) }),
  );
  try {
    const receipt = await grantPurpose(
      { db: getDb() },
      { userId: user.userId, key, consentDefinitionId, source: "api" },
    );
    if (key === CONSENT_KEYS.lenderSharing) {
      // Confirmed checks become proposals now (the scheduled sweep catches anything this misses).
      await proposeForConfirmedChecks(await lendingDeps(), { userId: user.userId }).catch((e) =>
        logger.error("lending.propose_failed", describeError(e)),
      );
    }
    return json({ receiptId: receipt.id }, 201);
  } catch (error) {
    if (error instanceof PrivacyError) throw new ApiError(409, error.code, "Complete onboarding first.");
    toApiError(error);
  }
});

/** Withdraws a purpose and applies its effects (pause, disconnect, erase — erasure may be deferred by a hold). */
export const DELETE = route<RouteContext<"/api/v1/consents/[key]">>("consents.withdraw", async (request, ctx) => {
  const user = await requireApiCreator(request);
  const key = await purposeKey(ctx);
  const hasBody = Number(request.headers.get("content-length") ?? "0") > 0;
  const { reason } = hasBody
    ? await readJson(request, z.object({ reason: z.enum(WITHDRAWAL_REASONS).nullish() }))
    : { reason: null };
  try {
    const result = await withdrawPurpose({ db: getDb() }, { userId: user.userId, key, reason, source: "api" });
    return json(result);
  } catch (error) {
    if (error instanceof PrivacyError && error.code === "not_granted") {
      throw new ApiError(409, "not_granted", "This consent isn't currently given.");
    }
    throw error;
  }
});
