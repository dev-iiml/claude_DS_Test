import "server-only";

import { cookies } from "next/headers";

import type { DbExecutor } from "@/db/types";
import { brandReadiness, brandUnlockActive, orgMayUnlock } from "@/modules/brand-orgs/access-service";
import { getCurrentUser } from "@/modules/identity";
import { isBrandMemberRole } from "@/modules/identity/policy";
import type { ViewerAccess } from "@/modules/public-passport/domain";
import { unlockCookieName } from "@/modules/public-passport/keys";
import { codeAccess, type ViewerVia } from "@/modules/public-passport/page-service";
import type { PassportRow } from "@/modules/public-passport/settings-service";

export interface Viewer {
  access: ViewerAccess;
  via: ViewerVia;
  isOwner: boolean;
  /** Set for a signed-in brand member. */
  brand: { orgName: string; ready: boolean; mayUnlock: boolean; unlocked: boolean; notReadyReason?: string } | null;
}

/**
 * Who is looking at a public passport, decided on the server for every
 * request: a valid unlock cookie for THIS passport (code still active), or a
 * verified brand member whose organisation unlocked it today. Everyone else —
 * including the creator themselves — sees the locked tier here.
 */
export async function resolveViewer(db: DbExecutor, passport: PassportRow, now = new Date()): Promise<Viewer> {
  const store = await cookies();
  const user = await getCurrentUser();
  const isOwner = user?.userId === passport.userId;
  const ready = user && isBrandMemberRole(user.role) ? await brandReadiness(db, user.userId) : null;
  const viewerOrgId = ready?.ok ? ready.membership.orgId : null;
  const viaCode = await codeAccess(db, passport, store.get(unlockCookieName(passport.id))?.value, now, viewerOrgId);

  let brand: Viewer["brand"] = null;
  if (ready) {
    if (ready.ok) {
      const mayUnlock = await orgMayUnlock(db, { passport, orgId: ready.membership.orgId, now });
      const unlocked = mayUnlock && (await brandUnlockActive(db, { passport, orgId: ready.membership.orgId, now }));
      brand = { orgName: ready.membership.orgName, ready: true, mayUnlock, unlocked };
    } else {
      brand = {
        orgName: "",
        ready: false,
        mayUnlock: false,
        unlocked: false,
        notReadyReason:
          ready.reason === "terms"
            ? "Accept the brand terms in your organisation's account first."
            : "Your organisation needs to be verified by CreatorCo first.",
      };
    }
  }
  if (brand?.unlocked) return { access: "unlocked", via: "brand", isOwner, brand };
  if (viaCode) return { access: "unlocked", via: "code", isOwner, brand };
  return { access: "locked", via: "direct", isOwner, brand };
}
