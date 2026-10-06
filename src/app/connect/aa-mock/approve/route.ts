import { NextResponse, type NextRequest } from "next/server";

import { getServerEnv } from "@/lib/env";
import { requireCreator } from "@/modules/identity";
import { getProviders } from "@/modules/integrations/registry";
import { MOCK_ACCOUNT_REF } from "@/providers/financial-data/mock-financial-data-provider";

import { BANK_CALLBACK_PATH } from "@/app/eligibility/_lib/constants";

const sameOrigin = (request: NextRequest) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(getServerEnv().APP_URL).origin || origin === request.nextUrl.origin;
};

/** Mock aggregator decision: a plain form POST answered with a 303 to the callback (full navigation). */
export async function POST(request: NextRequest) {
  if ((await getProviders()).financialData.descriptor.mode !== "mock") return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  await requireCreator();
  const form = await request.formData();
  const text = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const reference = text("reference");
  const decision = text("decision");
  const accounts = form
    .getAll("account")
    .filter((a): a is string => typeof a === "string" && MOCK_ACCOUNT_REF.test(a))
    .slice(0, 9);

  if (decision === "approve" && accounts.length === 0) {
    const back = new URL("/connect/aa-mock", request.nextUrl.origin);
    back.search = new URLSearchParams({ reference, extra: text("extra"), error: "select" }).toString();
    return NextResponse.redirect(back, 303);
  }
  const status = decision === "approve" ? "approved" : decision === "none" ? "no_accounts" : "rejected";
  const url = new URL(BANK_CALLBACK_PATH, request.nextUrl.origin);
  url.search = new URLSearchParams({
    reference,
    status,
    ...(status === "approved" ? { accounts: accounts.join(",") } : {}),
  }).toString();
  return NextResponse.redirect(url, 303);
}
