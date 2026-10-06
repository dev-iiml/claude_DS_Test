import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { requireCreator } from "@/modules/identity";
import { getPendingConnection } from "@/modules/social-data/connection-service";
import { encodeMockCode } from "@/providers/social/mock-social-data-provider";
import { getProviders } from "@/modules/integrations/registry";

import { CONNECT_CALLBACK_PATH } from "@/app/passport/connect/constants";

/**
 * Mock provider only: the "Allow" / "Cancel" decision from `/connect/mock`.
 * A plain form POST answered with a 303, so the browser performs a full
 * navigation to the callback — the same shape as a real OAuth redirect.
 */
export async function POST(request: NextRequest) {
  if ((await getProviders()).social.descriptor.mode !== "mock") return new NextResponse(null, { status: 404 });
  const appOrigin = new URL(getServerEnv().APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== appOrigin && origin !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }
  const user = await requireCreator();
  const form = await request.formData();
  const text = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const state = text("state");
  const handle = text("handle").trim().replace(/^@/, "");
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);

  const pending = state ? await getPendingConnection(getDb(), { userId: user.userId, state }) : null;
  if (!pending) return to("/passport?connect_error=invalid_state");
  if (text("decision") !== "allow") {
    return to(`${CONNECT_CALLBACK_PATH}?${new URLSearchParams({ state, error: "access_denied" })}`);
  }
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(handle)) {
    return to(`/connect/mock?${new URLSearchParams({ platform: pending.platform, state, invalid: "1" })}`);
  }
  const code = encodeMockCode({ platform: pending.platform, handle, nonce: randomBytes(8).toString("hex") });
  return to(`${CONNECT_CALLBACK_PATH}?${new URLSearchParams({ state, code })}`);
}
