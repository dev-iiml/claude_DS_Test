import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { describeError, logger } from "@/lib/logger";
import { JOB_HANDLERS, tick } from "@/modules/jobs";

export const dynamic = "force-dynamic";

function authorised(request: NextRequest, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled tick (e.g. Vercel Cron every 5 minutes): enqueues due schedules,
 * recovers stuck jobs and runs what's due. Disabled (404) unless CRON_SECRET
 * is configured; responds with counts only.
 */
export async function GET(request: NextRequest) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  if (!authorised(request, secret)) return new NextResponse(null, { status: 401 });
  try {
    const result = await tick({ db: getDb(), handlers: JOB_HANDLERS }, { limit: 20 });
    if (result.dead) logger.warn("jobs.dead", { dead: result.dead });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logger.error("jobs.tick_failed", describeError(error));
    return NextResponse.json({ error: "tick_failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
