import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { getDb } from "@/db";
import { getProfileStatus } from "@/modules/creator-profile/queries";
import { requireCreator } from "@/modules/identity";
import { getPassport } from "@/modules/passport/passport-view";

/**
 * Member areas (Home, Passport, Access, Account) need a signed-in creator with
 * a completed profile. Memoised per request so layouts and pages share it.
 */
export const requireMember = cache(async () => {
  const user = await requireCreator();
  const db = getDb();
  const status = await getProfileStatus(db, user.userId);
  if (status === "paused") redirect("/paused");
  const passport = await getPassport(db, user.userId);
  if (!passport) redirect("/onboarding");
  return { user, passport };
});

/**
 * The consent centre stays open while membership is paused (that is where a
 * creator resumes). Draft creators finish onboarding first.
 */
export const requireConsentCentreAccess = cache(async () => {
  const user = await requireCreator();
  const status = await getProfileStatus(getDb(), user.userId);
  if (status !== "completed" && status !== "paused") redirect("/onboarding");
  return { user, paused: status === "paused" };
});
