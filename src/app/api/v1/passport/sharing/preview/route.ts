import { getDb } from "@/db";
import { previewFor } from "@/modules/public-passport/page-service";
import { ensurePassport } from "@/modules/public-passport/settings-service";

import { requireApiMember } from "../../../access/_member";
import { toApiError } from "../../../_lib/errors";
import { ApiError, json, route } from "../../../_lib/http";

/** The creator's own page as a stranger (`as=locked`) or an unlocker (`as=unlocked`) would see it — the same view model. */
export const GET = route("passport_sharing.preview", async (request) => {
  const { user } = await requireApiMember(request);
  const as = request.nextUrl.searchParams.get("as") ?? "locked";
  if (as !== "locked" && as !== "unlocked")
    throw new ApiError(422, "validation_failed", "Use as=locked or as=unlocked.");
  try {
    const db = getDb();
    const passport = await ensurePassport(db, user.userId);
    const view = await previewFor(db, passport, as);
    if (!view) throw new ApiError(409, "unavailable", "The preview isn't available right now.");
    return json(view);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    toApiError(error);
  }
});
