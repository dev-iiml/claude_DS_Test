import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUser, homePathForUser } from "@/modules/identity";

/** Auth pages bounce an already-signed-in user to their role-aware home. */
export async function redirectIfSignedIn() {
  const user = await getCurrentUser();
  if (user) redirect(await homePathForUser(user));
}
