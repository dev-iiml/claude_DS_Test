import { z } from "zod";

import { getDb } from "@/db";
import { completeConnection } from "@/modules/social-data/connection-service";
import { getProviderByKey, getProviders } from "@/modules/integrations/registry";

import { requireApiCreator } from "../../../_lib/auth";
import { toApiError } from "../../../_lib/errors";
import { json, readJson, route } from "../../../_lib/http";

const body = z.object({ state: z.string().min(16).max(256), code: z.string().min(1).max(2048) });

/** Completes a connection with the `state` and `code` the provider returned. */
export const POST = route("social.connections.complete", async (request) => {
  const user = await requireApiCreator(request);
  const input = await readJson(request, body);
  try {
    const result = await completeConnection(
      { db: getDb(), social: (await getProviders()).social, socialFor: (key) => getProviderByKey("social", key) },
      { userId: user.userId, ...input },
    );
    return json(result, 201);
  } catch (error) {
    toApiError(error);
  }
});
