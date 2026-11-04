import { getDb } from "@/db";
import { getProfileStatus } from "@/modules/creator-profile/queries";
import { activityQuerySchema } from "@/modules/passport/activity-query";
import { ACTIVITY_PAGE_SIZE, getPassport, listActivity } from "@/modules/passport/passport-view";

import { requireApiCreator } from "../../_lib/auth";
import { ApiError, json, route } from "../../_lib/http";

/** The creator's own activity: `?kind=profile|identity|consent|accounts|signals&sort=newest|oldest&page=N`. */
export const GET = route("passport.activity", async (request) => {
  const user = await requireApiCreator(request);
  const db = getDb();
  if ((await getProfileStatus(db, user.userId)) === "paused") {
    throw new ApiError(409, "membership_paused", "Membership is paused. Give the Creator Profile consent to resume.");
  }
  const passport = await getPassport(db, user.userId);
  if (!passport) throw new ApiError(409, "profile_incomplete", "Complete onboarding to open your Passport.");
  const params = new URL(request.url).searchParams;
  const q = activityQuerySchema.parse({
    kind: params.get("kind") ?? undefined,
    sort: params.get("sort") ?? undefined,
    page: params.get("page") ?? undefined,
  });
  const { items, hasMore } = await listActivity(db, {
    userId: user.userId,
    creatorId: passport.creatorId,
    accountIds: passport.accounts.map((a) => a.id),
    kind: q.kind,
    order: q.sort,
    limit: ACTIVITY_PAGE_SIZE,
    offset: (q.page - 1) * ACTIVITY_PAGE_SIZE,
  });
  return json({ items, page: q.page, hasMore });
});
