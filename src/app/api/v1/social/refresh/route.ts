import { getDb } from "@/db";
import { refreshConnectedAccounts } from "@/modules/social-data/connection-service";
import { getProviders } from "@/modules/integrations/registry";

import { requireApiCreator } from "../../_lib/auth";
import { toApiError } from "../../_lib/errors";
import { json, route } from "../../_lib/http";

export const POST = route("social.refresh", async (request) => {
  const user = await requireApiCreator(request);
  try {
    return json(
      await refreshConnectedAccounts({ db: getDb(), social: (await getProviders()).social }, { userId: user.userId }),
    );
  } catch (error) {
    toApiError(error);
  }
});
