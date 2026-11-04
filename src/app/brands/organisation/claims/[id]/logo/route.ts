import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ImageUploadError, readCappedImage, sameOrigin, uploadProviders } from "@/app/_lib/image-uploads";
import { rateLimit } from "@/app/_lib/rate-limit";
import { describeError, logger } from "@/lib/logger";
import { uploadLogo } from "@/modules/brand-orgs/claims-service";
import { LOGO_MAX_BYTES } from "@/modules/brand-orgs/domain";
import { BrandOrgError } from "@/modules/brand-orgs/errors";
import { requireVerifiedBrandMember } from "@/modules/identity";

/**
 * A verified organisation's owner uploads a logo for a brand it claimed
 * (plain same-origin multipart form). The logo shows on Passports only after
 * two admins approve it. Redirects carry codes only.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/brands/organisation/claims/[id]/logo">) {
  const user = await requireVerifiedBrandMember();
  const { id } = await ctx.params;
  const back = (q: string) => NextResponse.redirect(new URL(`/brands/organisation?${q}#claims`, request.url), 303);
  if (!z.uuid().safeParse(id).success) return back("notice=logo_failed");
  if (!sameOrigin(request.headers.get("origin"), request.nextUrl.host))
    return new NextResponse("Forbidden", { status: 403 });
  if (!(await rateLimit("brand.logo_upload", user.userId)).ok) return back("notice=rate_limited");
  try {
    const { form, bytes, type } = await readCappedImage(request, LOGO_MAX_BYTES);
    await uploadLogo(await uploadProviders(), {
      userId: user.userId,
      claimId: id,
      bytes,
      declaredType: type,
      licenceAccepted: form.get("licence") === "on",
    });
  } catch (error) {
    if (error instanceof ImageUploadError)
      return back(error.code === "paused" ? "notice=logo_paused" : "notice=logo_rejected");
    if (error instanceof BrandOrgError)
      return back(
        error.code === "invalid"
          ? "notice=logo_licence"
          : error.code === "file_rejected"
            ? "notice=logo_rejected"
            : "notice=logo_failed",
      );
    logger.error("brand_app.logo_failed", describeError(error));
    return back("notice=logo_failed");
  }
  return back("notice=logo");
}
