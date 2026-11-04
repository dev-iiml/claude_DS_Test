import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { approvedLogoFor } from "@/modules/brand-orgs/logos";
import { resolveProviderByKey } from "@/modules/integrations/router";
import { passportViewFor, resolvePassportSlug } from "@/modules/public-passport/page-service";

import { resolveViewer } from "../../../_lib/viewer";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

/**
 * Public route, unlocked viewers only: an approved brand logo shown on THIS passport's brand list. A locked viewer —
 * or anyone guessing ids — gets 404, so a logo URL can't reveal who the creator worked with.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/p/[slug]/logo/[brandId]">) {
  const { slug, brandId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) return NOT_FOUND();
  const db = getDb();
  const r = await resolvePassportSlug(db, slug);
  if (r.kind !== "live") return NOT_FOUND();
  const viewer = await resolveViewer(db, r.passport);
  if (viewer.access !== "unlocked") return NOT_FOUND();
  const view = await passportViewFor(db, r.passport, "unlocked");
  const listed = view?.sections.some(
    (s) => s.field === "brands" && s.state === "shown" && s.rows.some((row) => row.logoBrandId === brandId),
  );
  if (!listed) return NOT_FOUND();
  const logo = await approvedLogoFor(db, brandId);
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
