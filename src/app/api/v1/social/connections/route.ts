import { z } from "zod";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { startConnection } from "@/modules/social-data/connection-service";
import { getProviders } from "@/modules/integrations/registry";

import { CONNECT_CALLBACK_PATH } from "@/app/passport/connect/constants";

import { requireApiCreator } from "../../_lib/auth";
import { toApiError } from "../../_lib/errors";
import { json, readJson, route } from "../../_lib/http";

const body = z.object({
  platform: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  connectionConsentId: z.uuid(),
  analyticsConsentId: z.uuid().nullish(),
  /** Add another account on a platform that already has a connected one (max 3 per platform). */
  additional: z.boolean().optional(),
});

/**
 * Starts a connection. Returns the provider authorisation URL to open in a
 * system browser sheet; the provider returns to the registered callback.
 */
export const POST = route("social.connections.start", async (request) => {
  const user = await requireApiCreator(request);
  const input = await readJson(request, body);
  try {
    const result = await startConnection(
      { db: getDb(), social: (await getProviders()).social },
      {
        userId: user.userId,
        platform: input.platform,
        redirectUri: new URL(CONNECT_CALLBACK_PATH, getServerEnv().APP_URL).toString(),
        connectionConsentId: input.connectionConsentId,
        analyticsConsentId: input.analyticsConsentId ?? null,
        additional: input.additional ?? false,
      },
    );
    return json(result, 201);
  } catch (error) {
    toApiError(error);
  }
});
