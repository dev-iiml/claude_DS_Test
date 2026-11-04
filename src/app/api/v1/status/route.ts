import { getDb } from "@/db";
import { getCreatorStatus } from "@/modules/creator-status/status-service";

import { json, route } from "../_lib/http";
import { requireApiMember } from "../access/_member";

/** Creator Status: tier, rules version and every criterion (membership standing — never a credit input). */
export const GET = route("status", async (request) => {
  const { creatorId } = await requireApiMember(request);
  return json(await getCreatorStatus(getDb(), creatorId));
});
