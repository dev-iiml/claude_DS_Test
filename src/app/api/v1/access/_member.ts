import "server-only";

import type { NextRequest } from "next/server";

import { getDb } from "@/db";
import { getProfileStatus } from "@/modules/creator-profile/queries";
import { getPassport } from "@/modules/passport/passport-view";

import { requireApiCreator } from "../_lib/auth";
import { ApiError } from "../_lib/http";

/** Access, Creator Status and points need an active membership (like the web member areas). */
export async function requireApiMember(request: NextRequest) {
  const user = await requireApiCreator(request);
  const db = getDb();
  if ((await getProfileStatus(db, user.userId)) === "paused") {
    throw new ApiError(409, "membership_paused", "Membership is paused. Give the Creator Profile consent to resume.");
  }
  const passport = await getPassport(db, user.userId);
  if (!passport) throw new ApiError(409, "profile_incomplete", "Complete onboarding first.");
  return { user, creatorId: passport.creatorId, passport };
}
