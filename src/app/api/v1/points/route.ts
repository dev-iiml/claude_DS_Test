import { getDb } from "@/db";
import { getPointsSummary } from "@/modules/rewards/ledger-service";
import { EARN_GUIDE } from "@/modules/rewards/presentation";
import { POINTS_RULES_VERSION, POINTS_TERMS } from "@/modules/rewards/rules";
import { listTasksForCreator } from "@/modules/rewards/tasks-service";

import { json, route } from "../_lib/http";
import { requireApiMember } from "../access/_member";

/** Creator Points: balance, points held for requests, history, tasks and how points are earned. Not money. */
export const GET = route("points", async (request) => {
  const { creatorId } = await requireApiMember(request);
  const db = getDb();
  const [summary, tasks] = await Promise.all([getPointsSummary(db, creatorId), listTasksForCreator(db, creatorId)]);
  return json({ ...summary, rulesVersion: POINTS_RULES_VERSION, earnGuide: EARN_GUIDE, tasks, terms: POINTS_TERMS });
});
