import { getDb } from "@/db";
import { getPointsSummary } from "@/modules/rewards/ledger-service";
import { EARN_RULES, POINTS_RULES_VERSION, POINTS_TERMS } from "@/modules/rewards/rules";

import { json, route } from "../_lib/http";
import { requireApiMember } from "../access/_member";

/** Creator Points: balance, points held for requests, history, and how points are earned. Not money. */
export const GET = route("points", async (request) => {
  const { creatorId } = await requireApiMember(request);
  const db = getDb();
  const summary = await getPointsSummary(db, creatorId);
  return json({ ...summary, rulesVersion: POINTS_RULES_VERSION, earnRules: EARN_RULES, terms: POINTS_TERMS });
});
