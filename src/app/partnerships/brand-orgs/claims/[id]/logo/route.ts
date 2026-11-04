import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { logoForReview } from "@/modules/brand-orgs/review-service";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { resolveProviderByKey } from "@/modules/integrations/router";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

/** A reviewer views an uploaded logo (scanned clean) before deciding on it. Every view is audited. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/partnerships/brand-orgs/claims/[id]/logo">) {
  const staff = await requirePartnershipsAdmin();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NOT_FOUND();
  const db = getDb();
  const logo = await logoForReview(db, { staffId: staff.userId, claimId: id });
  if (!logo) return NOT_FOUND();
  const storage = await resolveProviderByKey(
    { db, production: getServerEnv().APP_ENV === "production" },
    "document_storage",
    logo.provider,
  );
  if (!storage) return NOT_FOUND();
  try {
    const object = await storage.get({ key: logo.key });
    return new NextResponse(Buffer.from(object.bytes), {
      headers: { "content-type": logo.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return NOT_FOUND();
  }
}
