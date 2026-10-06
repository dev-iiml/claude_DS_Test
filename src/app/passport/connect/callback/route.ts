import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { getDb } from "@/db";
import { describeError, logger } from "@/lib/logger";
import { requireCreator } from "@/modules/identity";
import { SocialConnectionError, completeConnection } from "@/modules/social-data/connection-service";
import { getProviderByKey, getProviders } from "@/modules/integrations/registry";

/**
 * OAuth-style return leg. The `state` is verified server-side (hashed,
 * single-use, owner-bound, 10-minute expiry) before the code is exchanged.
 * Query values are never logged.
 */
export async function GET(request: NextRequest) {
  const user = await requireCreator();
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");

  if (params.get("error")) redirect("/passport?connect_error=cancelled");
  if (!state || !code || state.length > 256 || code.length > 2048) redirect("/passport?connect_error=invalid_state");

  let platform: string;
  try {
    const result = await completeConnection(
      { db: getDb(), social: (await getProviders()).social, socialFor: (key) => getProviderByKey("social", key) },
      { userId: user.userId, state, code },
    );
    platform = result.platform;
  } catch (error) {
    if (error instanceof SocialConnectionError) redirect(`/passport?connect_error=${error.code}`);
    logger.error("social.connect_complete_failed", describeError(error));
    redirect("/passport?connect_error=provider_error");
  }
  redirect(`/passport?connected=${encodeURIComponent(platform)}`);
}
