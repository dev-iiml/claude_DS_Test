import { getDb } from "@/db";
import { orgDailyQuota, orgUnlocksToday } from "@/modules/brand-orgs/access-service";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import { requireApiBrandMember } from "../../_lib/auth";
import { json, route } from "../../_lib/http";

/** The brand member's organisation: verification status, terms, and today's unlocks against the quota. */
export const GET = route("brand.status", async (request) => {
  const user = await requireApiBrandMember(request);
  const m = user.membership;
  const db = getDb();
  const verified = m.orgStatus === "verified";
  const now = new Date();
  return json({
    organisation: { name: m.orgName, type: m.orgType, status: m.orgStatus, role: m.orgRole },
    termsAccepted: m.termsAccepted,
    unlocks: verified
      ? { today: await orgUnlocksToday(db, m.orgId, now), dailyQuota: await orgDailyQuota(db, m.orgId) }
      : null,
    discovery: verified && (await isFeatureEnabled(db, "brand_discovery")),
  });
});
