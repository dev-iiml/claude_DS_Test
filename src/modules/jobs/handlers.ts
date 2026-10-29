import { expireAccessRequests } from "@/modules/access";
import { maintainAnalytics } from "@/modules/analytics/maintenance";
import { expireStaleApplications } from "@/modules/financial-eligibility/application-service";
import { resolveProvider, resolveProviderByKey } from "@/modules/integrations/router";
import { processLenderProposals } from "@/modules/lending";
import { deliverPartnerWebhooks } from "@/modules/partners";
import { purgeExpiredFiData } from "@/modules/financial-eligibility/cashflow-service";
import { expireStaleChanges, runHealthChecks } from "@/modules/integrations";
import { processDeferredErasures } from "@/modules/privacy";
import { purgeRateLimitCounters } from "@/modules/rate-limit";
import { purgeAuthRecords } from "@/modules/identity/housekeeping";

import type { JobHandlers } from "./runner";

/**
 * What each job type does. Handlers are idempotent sweeps over the owning
 * domain's services, so a retry never double-applies anything, and return
 * counts only.
 */
export const JOB_HANDLERS: JobHandlers = {
  expire_stale_applications: async ({ db, now }) => ({ expired: await expireStaleApplications({ db, now }) }),
  process_deferred_erasures: async ({ db, now }) => processDeferredErasures({ db, now }),
  purge_expired_fi_data: async ({ db, now }) => purgeExpiredFiData({ db, now }),
  process_lender_proposals: async ({ db, now }) => {
    const routing = { db, production: process.env.APP_ENV === "production" };
    const { provider } = await resolveProvider(routing, "lender");
    const result = await processLenderProposals({
      db,
      now,
      lender: provider,
      lenderFor: (key) => resolveProviderByKey(routing, "lender", key),
    });
    // Announce newly submitted proposals to partner-API lenders without waiting for the next delivery run.
    const webhooks = await deliverPartnerWebhooks({ db });
    return { ...result, webhooks_delivered: webhooks.delivered };
  },
  // Real time per send (signatures carry it), never the tick's start time.
  deliver_partner_webhooks: async ({ db }) => deliverPartnerWebhooks({ db }),
  expire_access_requests: async ({ db, now }) => expireAccessRequests({ db, now }),
  analytics_maintenance: async ({ db, now }) => maintainAnalytics({ db, now }),
  rate_limit_purge: async ({ db, now }) => purgeRateLimitCounters(db, now),
  purge_auth_records: async ({ db, now }) => purgeAuthRecords(db, now),
  provider_health_check: async ({ db, now }) => {
    const health = await runHealthChecks({ db, now, production: process.env.APP_ENV === "production" });
    return { ...health, expired_changes: await expireStaleChanges({ db, now }) };
  },
};
