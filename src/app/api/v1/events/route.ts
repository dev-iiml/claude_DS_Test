import { z } from "zod";

import { getDb } from "@/db";
import { recordEvent } from "@/modules/analytics";
import { ANALYTICS_EVENTS, CLIENT_EVENTS, type AnalyticsEvent } from "@/modules/analytics/events";

import { requireApiCreator } from "../_lib/auth";
import { ApiError, json, readJson, route } from "../_lib/http";

/** Screen-view events a native app may send for the signed-in creator (Stage 15). */
const USER_CLIENT_EVENTS = CLIENT_EVENTS.filter((e) => ANALYTICS_EVENTS[e].subject === "user") as [
  AnalyticsEvent,
  ...AnalyticsEvent[],
];

/**
 * Records a screen view from a native app: `{ event, props }`. Only the
 * client-emittable view events are accepted, with the same strict property
 * schemas as the server's own events; they're recorded only if the creator has
 * the Product analytics consent (`{ recorded: false }` otherwise).
 */
export const POST = route("events.record", async (request) => {
  const user = await requireApiCreator(request);
  const body = await readJson(
    request,
    z.object({ event: z.enum(USER_CLIENT_EVENTS), props: z.record(z.string(), z.unknown()).default({}) }).strict(),
  );
  const parsed = ANALYTICS_EVENTS[body.event].props.safeParse(body.props);
  if (!parsed.success) throw new ApiError(422, "invalid", "These properties aren't allowed for this event.");
  const outcome = await recordEvent(getDb(), {
    event: body.event,
    userId: user.userId,
    props: parsed.data as never,
  });
  return json({ recorded: outcome === "recorded" }, 202);
});
