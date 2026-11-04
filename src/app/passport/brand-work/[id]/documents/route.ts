import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { handleBrandWorkUpload } from "@/app/_lib/brand-work-uploads";
import { rateLimit } from "@/app/_lib/rate-limit";
import { describeError, logger } from "@/lib/logger";
import { BrandWorkError } from "@/modules/brand-work";
import { requireCreator } from "@/modules/identity";

/**
 * Web upload of one brand-work document (a plain multipart form — no
 * client script, the strict CSP is unchanged). Same-origin only. Redirects
 * back to the record with a neutral message; never echoes the filename.
 */
/** `Origin: null` (sandboxed frames, some redirects) or anything unparsable counts as cross-site. */
function sameOrigin(origin: string | null, host: string) {
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, ctx: RouteContext<"/passport/brand-work/[id]/documents">) {
  const user = await requireCreator();
  const { id } = await ctx.params;
  const back = (q: string) => NextResponse.redirect(new URL(`/passport/brand-work/${id}?${q}`, request.url), 303);
  if (!z.uuid().safeParse(id).success) return NextResponse.redirect(new URL("/passport/brand-work", request.url), 303);
  // Route handlers don't get server actions' CSRF protection: insist on a same-origin form post.
  const origin = request.headers.get("origin");
  if (!sameOrigin(origin, request.nextUrl.host)) return new NextResponse("Forbidden", { status: 403 });
  const limited = await rateLimit("brand_work.upload", user.userId);
  if (!limited.ok) return back("error=rate_limited");
  try {
    await handleBrandWorkUpload(request, { userId: user.userId, recordId: id });
  } catch (error) {
    // Codes only in the URL (the page maps them to fixed text), so a crafted link can't show arbitrary messages.
    if (error instanceof BrandWorkError) return back(`error=${error.code}`);
    logger.error("brand_work.upload_failed", describeError(error));
    return back("notice=upload_failed");
  }
  return back("notice=uploaded");
}
