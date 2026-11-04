import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { requireBrandWorkReviewer } from "@/modules/identity";
import { resolveProviderByKey } from "@/modules/integrations/router";
import { documentForViewer } from "@/modules/brand-work/documents-service";
import { verifyMockSignedUrl } from "@/providers/document-storage/mock-document-storage-provider";

/**
 * The mock storage's "signed URL" target: a staff-only route that checks the
 * role, the link's signature (issued by this process to this reviewer) and
 * expiry, and that the document is clean and not on the viewer's own record.
 * A real vendor's signed URL points at the vendor instead. Each issue was audited.
 */
export async function GET(request: NextRequest) {
  const staff = await requireBrandWorkReviewer();
  const key = request.nextUrl.searchParams.get("key") ?? "";
  const exp = Number(request.nextUrl.searchParams.get("exp") ?? "0");
  const sig = request.nextUrl.searchParams.get("sig") ?? "";
  if (!/^bw\/[0-9a-f]{32}$/.test(key) || !verifyMockSignedUrl({ key, exp, viewerId: staff.userId, sig }))
    return new NextResponse("This link has expired. Open the document again from the record.", { status: 410 });
  const db = getDb();
  const doc = await documentForViewer(db, key, staff.userId);
  if (!doc) return new NextResponse("Not found", { status: 404 });
  const storage = await resolveProviderByKey(
    { db, production: getServerEnv().APP_ENV === "production" },
    "document_storage",
    doc.provider,
  );
  if (!storage) return new NextResponse("Storage unavailable", { status: 503 });
  try {
    const object = await storage.get({ key });
    return new NextResponse(Buffer.from(object.bytes), {
      headers: {
        "content-type": doc.mime,
        "content-disposition": "inline",
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
