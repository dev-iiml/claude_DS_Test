import { z } from "zod";

import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { parseCampaigns, reduceTags } from "@/modules/analytics/attribution";
import { authDeps } from "@/modules/identity";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { signUpSchema } from "@/modules/identity/auth/schemas";

import { API_CLIENTS } from "../../_lib/auth";
import { ApiError, json, rateLimited, readJson, route } from "../../_lib/http";

/** Optional campaign tags from the app's install/deep link (reduced to reviewed values; see attribution.ts). */
const attribution = z
  .object({ utm_source: z.string().max(80), utm_medium: z.string().max(80), utm_campaign: z.string().max(80) })
  .partial()
  .strict()
  .optional();

const body = z.intersection(signUpSchema, z.object({ client: z.enum(API_CLIENTS), attribution }));

/** Creates a creator account and returns a bearer session for a native/API client. */
export const POST = route("auth.sign_up", async (request) => {
  const input = await readJson(request, body);
  const limited = await rateLimit("auth.sign_up", clientIpFrom(request.headers));
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  const tags = input.attribution ?? {};
  const result = await signUpCreator(authDeps(), {
    ...input,
    attribution: { ...reduceTags(tags, parseCampaigns(process.env.ANALYTICS_CAMPAIGNS)), referrer: null },
  });
  if (!result.ok) throw new ApiError(409, "email_taken", "An account with this email already exists.");
  return json(
    {
      token: result.session.token,
      expiresAt: result.session.expiresAt,
      user: { id: result.user.userId, email: result.user.email, role: result.user.role },
    },
    201,
  );
});
