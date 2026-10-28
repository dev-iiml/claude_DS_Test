import "server-only";

import { after } from "next/server";

import { getDb } from "@/db";
import { logger } from "@/lib/logger";
import { recordEvent, type RecordEventInput } from "@/modules/analytics";
import type { AnalyticsEvent } from "@/modules/analytics/events";

/**
 * Records a page-view event after the response has been sent (Stage 15), so
 * measurement never slows or breaks a page. Server-side only — no browser
 * trackers or third-party scripts. Consent and staff checks happen in
 * `recordEvent`.
 */
export function recordAfterResponse<E extends AnalyticsEvent>(input: RecordEventInput<E>) {
  after(async () => {
    try {
      await recordEvent(getDb(), input);
    } catch {
      logger.error("analytics.page_event_failed", { event: input.event });
    }
  });
}
