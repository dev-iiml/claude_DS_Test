import { NextResponse, type NextRequest } from "next/server";

import { ImageUploadError, readCappedImage, sameOrigin, uploadProviders } from "@/app/_lib/image-uploads";
import { rateLimit } from "@/app/_lib/rate-limit";
import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { describeError, logger } from "@/lib/logger";
import { requireCreator } from "@/modules/identity";
import { resolveProviderByKey } from "@/modules/integrations/router";
import { PHOTO_MAX_BYTES } from "@/modules/public-passport/domain";
import { PassportError } from "@/modules/public-passport/errors";
import { uploadPassportPhoto } from "@/modules/public-passport/photo-service";
import { ensurePassport } from "@/modules/public-passport/settings-service";

/**
 * The creator's own passport photo: POST uploads (a plain same-origin
 * multipart form — no client script), GET serves it to its owner for the
 * Sharing preview. Redirects carry codes only, mapped to fixed text.
 */

const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET() {
  const user = await requireCreator();
  const db = getDb();
  let p;
  try {
    p = await ensurePassport(db, user.userId);
  } catch {
    return NOT_FOUND();
  }
  if (!p.photoKey || p.photoScan !== "clean" || !p.photoProvider) return NOT_FOUND();
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

export async function POST(request: NextRequest) {
  const user = await requireCreator();
  const back = (q: string) => NextResponse.redirect(new URL(`/passport/sharing?${q}#profile`, request.url), 303);
  if (!sameOrigin(request.headers.get("origin"), request.nextUrl.host))
    return new NextResponse("Forbidden", { status: 403 });
  const limited = await rateLimit("passport.photo_upload", user.userId);
  if (!limited.ok) return back("error=rate_limited");
  try {
    const { bytes, type } = await readCappedImage(request, PHOTO_MAX_BYTES);
    await uploadPassportPhoto({ ...(await uploadProviders()) }, { userId: user.userId, bytes, declaredType: type });
  } catch (error) {
    if (error instanceof ImageUploadError) return back(`error=photo_${error.code}`);
    if (error instanceof PassportError) return back(`error=photo_${error.code}`);
    logger.error("passport_sharing.photo_failed", describeError(error));
    return back("error=photo_failed");
  }
  return back("notice=photo");
}
