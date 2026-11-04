import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { resolveProviderByKey } from "@/modules/integrations/router";
import { canSee, normaliseFieldTiers } from "@/modules/public-passport/domain";
import { resolvePassportSlug } from "@/modules/public-passport/page-service";

import { resolveViewer } from "../../_lib/viewer";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

/** Public: the creator's photo, only while the passport is live and the viewer may see the profile field. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/p/[slug]/photo">) {
  const { slug } = await ctx.params;
  const db = getDb();
  const r = await resolvePassportSlug(db, slug);
  if (r.kind !== "live") return NOT_FOUND();
  const p = r.passport;
  if (!p.photoKey || p.photoScan !== "clean" || !p.photoProvider) return NOT_FOUND();
  const viewer = await resolveViewer(db, p);
  if (!canSee(normaliseFieldTiers(p.fieldTiers).profile, viewer.access)) return NOT_FOUND();
  const storage = await resolveProviderByKey(
    { db, production: getServerEnv().APP_ENV === "production" },
    "document_storage",
    p.photoProvider,
  );
  if (!storage) return NOT_FOUND();
  try {
    const object = await storage.get({ key: p.photoKey });
    return new NextResponse(Buffer.from(object.bytes), {
      headers: {
        "content-type": p.photoMime ?? "application/octet-stream",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NOT_FOUND();
  }
}
