import { getDb } from "@/db";
import { listAccessLog } from "@/modules/public-passport/codes-service";

import { requireApiMember } from "../../../access/_member";
import { toApiError } from "../../../_lib/errors";
import { json, route } from "../../../_lib/http";

/** Who unlocked the passport: India day + hour, code label, typed (unverified) name/company, or a verified organisation. */
export const GET = route("passport_access_log.list", async (request) => {
  const { user } = await requireApiMember(request);
  try {
    return json({ entries: await listAccessLog(getDb(), user.userId) });
  } catch (error) {
    toApiError(error);
  }
});
