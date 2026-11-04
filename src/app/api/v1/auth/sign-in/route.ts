import { z } from "zod";

import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { authDeps } from "@/modules/identity";
import { LOGIN_WINDOW_MINUTES, signIn } from "@/modules/identity/auth/auth-service";
import { signInSchema } from "@/modules/identity/auth/schemas";

import { API_CLIENTS } from "../../_lib/auth";
import { ApiError, json, rateLimited, readJson, route } from "../../_lib/http";

const body = signInSchema.extend({ client: z.enum(API_CLIENTS) });

export const POST = route("auth.sign_in", async (request) => {
  const input = await readJson(request, body);
  const limited = await rateLimit("auth.sign_in", clientIpFrom(request.headers));
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  const result = await signIn(authDeps(), input);
  if (!result.ok) {
    if (result.reason === "locked") {
      throw new ApiError(429, "locked", `Too many attempts. Try again in ${LOGIN_WINDOW_MINUTES} minutes.`);
    }
    if (result.reason === "inactive") throw new ApiError(403, "inactive", "This account is not active.");
    throw new ApiError(401, "invalid_credentials", "That email and password don't match our records.");
  }
  return json({
    token: result.session.token,
    expiresAt: result.session.expiresAt,
    user: { id: result.user.userId, email: result.user.email, role: result.user.role },
  });
});
