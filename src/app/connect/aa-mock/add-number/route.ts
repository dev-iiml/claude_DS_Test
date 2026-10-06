import { NextResponse, type NextRequest } from "next/server";

import { getServerEnv } from "@/lib/env";
import { requireCreator } from "@/modules/identity";
import { getProviders } from "@/modules/integrations/registry";

/**
 * Mock in-journey "add another mobile number": the aggregator verifies the
 * number by OTP (any 6 digits here) and searches it. Only the last four digits
 * go back into the URL; the number itself is dropped.
 */
export async function POST(request: NextRequest) {
  if ((await getProviders()).financialData.descriptor.mode !== "mock") return new NextResponse(null, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(getServerEnv().APP_URL).origin && origin !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }
  await requireCreator();
  const form = await request.formData();
  const text = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string).trim() : "");
  const reference = text("reference");
  const extra = text("extra")
    .split(",")
    .filter((x) => /^\d{4}$/.test(x));
  const mobile = text("mobile").replace(/\D/g, "");
  const back = new URL("/connect/aa-mock", request.nextUrl.origin);
  const params = new URLSearchParams({ reference });
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    params.set("extra", extra.join(","));
    params.set("error", "mobile");
  } else if (!/^\d{6}$/.test(text("otp"))) {
    params.set("extra", extra.join(","));
    params.set("error", "otp");
  } else {
    params.set("extra", [...new Set([...extra, mobile.slice(-4)])].slice(0, 2).join(","));
  }
  back.search = params.toString();
  return NextResponse.redirect(back, 303);
}
