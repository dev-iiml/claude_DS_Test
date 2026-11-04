import { z } from "zod";

import { clientIp, rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { brandUnlock } from "@/modules/brand-orgs/access-service";
import { passportViewFor, resolvePassportSlug } from "@/modules/public-passport/page-service";
import { ipPseudonym } from "@/modules/public-passport/keys";

import { requireApiBrandMember } from "../../_lib/auth";
import { toApiError } from "../../_lib/errors";
import { ApiError, json, rateLimited, readJson, route } from "../../_lib/http";

/**
 * A verified brand member unlocks a passport by its link for their
 * organisation (for the India day; counts against the daily quota once). The
 * response is the UNLOCKED view model — bands only, never exact amounts.
 */
export const POST = route("brand.unlock", async (request) => {
  const user = await requireApiBrandMember(request);
  const body = await readJson(request, z.object({ slug: z.string().max(40) }).strict());
  const limited = await rateLimit("brand.unlock", user.userId);
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  const db = getDb();
  const r = await resolvePassportSlug(db, body.slug);
  if (r.kind !== "live") throw new ApiError(404, "not_found", "No such passport.");
  try {
    const result = await brandUnlock(db, {
      userId: user.userId,
      passportId: r.passport.id,
      ipPseudonym: ipPseudonym(await clientIp()),
    });
    const view = await passportViewFor(db, r.passport, "unlocked");
    if (!view) throw new ApiError(404, "not_found", "No such passport.");
    return json({ alreadyUnlocked: result.alreadyUnlocked, view });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    toApiError(error);
  }
});
