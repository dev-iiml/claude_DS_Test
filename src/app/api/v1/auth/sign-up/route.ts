import { z } from "zod";

import { authDeps } from "@/modules/identity";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { signUpSchema } from "@/modules/identity/auth/schemas";

import { API_CLIENTS } from "../../_lib/auth";
import { ApiError, json, readJson, route } from "../../_lib/http";

const body = z.intersection(signUpSchema, z.object({ client: z.enum(API_CLIENTS) }));

/** Creates a creator account and returns a bearer session for a native/API client. */
export const POST = route("auth.sign_up", async (request) => {
  const input = await readJson(request, body);
  const result = await signUpCreator(authDeps(), input);
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
