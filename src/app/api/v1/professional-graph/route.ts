import { z } from "zod";

import { getDb } from "@/db";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { getOnboardingState } from "@/modules/creator-profile/queries";
import { getLatestProfessionalGraph } from "@/modules/professional-graph/graph-service";
import { PrivacyError, withdrawPurpose } from "@/modules/privacy";
import { enableProfessionalAnalytics } from "@/modules/social-data/connection-service";

import { requireApiCreator } from "../_lib/auth";
import { toApiError } from "../_lib/errors";
import { ApiError, json, noContent, readJson, route } from "../_lib/http";

/** Latest professional signals (only while the analytics consent is in force). Not a credit score. */
export const GET = route("graph.get", async (request) => {
  const user = await requireApiCreator(request);
  const db = getDb();
  const { profile } = await getOnboardingState(db, user.userId);
  if (!profile) throw new ApiError(409, "profile_incomplete", "Complete onboarding first.");
  const enabled = await hasValidConsent(db, user.userId, CONSENT_KEYS.professionalAnalytics);
  return json({ enabled, graph: enabled ? await getLatestProfessionalGraph(db, profile.id) : null });
});

/** Turns professional analytics on (separate consent) and computes signals. */
export const POST = route("graph.enable", async (request) => {
  const user = await requireApiCreator(request);
  const { consentDefinitionId } = await readJson(request, z.object({ consentDefinitionId: z.uuid() }));
  try {
    const result = await enableProfessionalAnalytics(getDb(), { userId: user.userId, consentDefinitionId });
    if (!result.ok) throw new ApiError(409, result.reason, "Signals couldn't be computed.");
    return json({ runId: result.runId, reused: result.reused }, 201);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    toApiError(error);
  }
});

/** Turns professional analytics off: withdraws the consent and erases computed signals. Idempotent. */
export const DELETE = route("graph.disable", async (request) => {
  const user = await requireApiCreator(request);
  try {
    await withdrawPurpose(
      { db: getDb() },
      { userId: user.userId, key: CONSENT_KEYS.professionalAnalytics, source: "api" },
    );
  } catch (error) {
    if (!(error instanceof PrivacyError && error.code === "not_granted")) throw error;
  }
  return noContent();
});
