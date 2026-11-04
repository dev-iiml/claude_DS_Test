import "server-only";

import { after } from "next/server";

import { getDb } from "@/db";
import { logger } from "@/lib/logger";
import { recordEvent, type RecordEventInput } from "@/modules/analytics";
import { ANALYTICS_EVENTS, type AnalyticsEvent } from "@/modules/analytics/events";

import { clientIp, rateLimit } from "./rate-limit";

/**
 * Records a page-view event after the response has been sent (Stage 15), so
 * measurement never slows or breaks a page. Server-side only — no browser
 * trackers or third-party scripts. Consent and staff checks happen in
 * `recordEvent`.
 *
 * Signed-out views (no identifier) are capped per network per hour (Stage 16)
 * so a bot can't inflate the funnel; over the cap the page still renders and
 * the view just isn't counted. The IP is read here (request APIs aren't
 * available inside `after` in a page) and only its keyed hash is counted.
 */
export async function recordAfterResponse<E extends AnalyticsEvent>(input: RecordEventInput<E>) {
  const anonymous = ANALYTICS_EVENTS[input.event].subject === "anonymous";
  const ip = anonymous ? await clientIp() : null;
  after(async () => {
    try {
      if (anonymous && !(await rateLimit("analytics.anonymous_view", ip)).ok) return;
      await recordEvent(getDb(), input);
    } catch {
      logger.error("analytics.page_event_failed", { event: input.event });
    }
  });
}
