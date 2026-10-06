import { authDeps } from "@/modules/identity";
import { signOut } from "@/modules/identity/auth/auth-service";

import { requireApiUser } from "../../_lib/auth";
import { noContent, route } from "../../_lib/http";

/** Revokes the bearer session used for this request. */
export const POST = route("auth.sign_out", async (request) => {
  const user = await requireApiUser(request);
  await signOut(authDeps(), user.token);
  return noContent();
});
