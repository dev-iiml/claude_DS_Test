import { getDb } from "@/db";
import { getProfileStatus } from "@/modules/creator-profile/queries";
import { getPassport } from "@/modules/passport/passport-view";

import { requireApiCreator } from "../_lib/auth";
import { ApiError, json, route } from "../_lib/http";

/** The Creator Passport read model — the same shape the web Passport renders. */
export const GET = route("passport", async (request) => {
  const user = await requireApiCreator(request);
  const db = getDb();
  if ((await getProfileStatus(db, user.userId)) === "paused") {
    throw new ApiError(409, "membership_paused", "Membership is paused. Give the Creator Profile consent to resume.");
  }
  const passport = await getPassport(db, user.userId);
  if (!passport) throw new ApiError(409, "profile_incomplete", "Complete onboarding to open your Passport.");
  return json(passport);
});
