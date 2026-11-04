import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { discoverCreators } from "@/modules/brand-orgs/access-service";

import { requireApiBrandMember } from "../../_lib/auth";
import { toApiError } from "../../_lib/errors";
import { json, rateLimited, route } from "../../_lib/http";

/** Discovery (behind the /ops switch): creators who chose to be found, PUBLIC tier only. Filters match public values. */
export const GET = route("brand.discover", async (request) => {
  const user = await requireApiBrandMember(request);
  const limited = await rateLimit("brand.discovery", user.userId);
  if (!limited.ok) throw rateLimited(limited.retryAfterSeconds);
  const p = request.nextUrl.searchParams;
  const f = (k: string) => (p.get(k) ?? "").slice(0, 40) || undefined;
  try {
    const results = await discoverCreators(getDb(), {
      userId: user.userId,
      filters: {
        category: f("category"),
        platform: f("platform"),
        followerBand: f("followerBand"),
        industry: f("industry"),
        city: f("city"),
      },
    });
    return json({ results: results.map((r) => ({ url: `/p/${r.slug}`, slug: r.slug, view: r.view })) });
  } catch (error) {
    toApiError(error);
  }
});
