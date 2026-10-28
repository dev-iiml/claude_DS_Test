import { ADMIN_ROLES, ANALYTICS_ROLES, OPS_ROLES, PARTNERSHIPS_ROLES, type UserRole } from "./domain";

/**
 * Pure authorisation and routing policy. Kept free of framework and database
 * code so it can be unit-tested exhaustively.
 */
export function isAdminRole(role: UserRole): boolean {
  return (ADMIN_ROLES as readonly UserRole[]).includes(role);
}

export function canAccessAdmin(role: UserRole): boolean {
  return isAdminRole(role);
}

export function canAccessOps(role: UserRole): boolean {
  return (OPS_ROLES as readonly UserRole[]).includes(role);
}

export function canAccessPartnerships(role: UserRole): boolean {
  return (PARTNERSHIPS_ROLES as readonly UserRole[]).includes(role);
}

/** Aggregate analytics (`/insights`): analysts, risk admins and super admins. */
export function canAccessInsights(role: UserRole): boolean {
  return (ANALYTICS_ROLES as readonly UserRole[]).includes(role);
}

/** Staff never use creator areas. */
export function isStaffRole(role: UserRole): boolean {
  return role !== "creator";
}

/** Creator-facing areas are for creators only; staff use the admin console. */
export function canAccessCreatorArea(role: UserRole): boolean {
  return role === "creator";
}

export interface RoutingSubject {
  role: UserRole;
  /** Whether the creator has completed onboarding (ignored for staff). */
  onboardingComplete: boolean;
}

/** Creator areas that require a completed profile. */
export const MEMBER_AREAS = [
  "/dashboard",
  "/passport",
  "/account",
  "/access",
  "/connect",
  "/paused",
  "/eligibility",
] as const;

export function homePathFor(subject: RoutingSubject): string {
  if (isAdminRole(subject.role)) return "/admin";
  if (canAccessOps(subject.role)) return "/ops";
  if (canAccessPartnerships(subject.role)) return "/partnerships";
  if (canAccessInsights(subject.role)) return "/insights";
  return subject.onboardingComplete ? "/dashboard" : "/onboarding";
}

/**
 * Only same-origin, absolute-path redirects are honoured (no `//host`, no
 * schemes, no back-slashes), and only into areas the role may access.
 */
export function safeNextPath(next: string | null | undefined, subject: RoutingSubject): string | null {
  if (!next || next.length > 512) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) {
    return null;
  }
  const path = next.split(/[?#]/)[0] ?? "";
  if (path === "/login" || path === "/signup") return null;
  if (path === "/admin" || path.startsWith("/admin/")) return canAccessAdmin(subject.role) ? next : null;
  if (path === "/ops" || path.startsWith("/ops/")) return canAccessOps(subject.role) ? next : null;
  if (path === "/insights" || path.startsWith("/insights/")) return canAccessInsights(subject.role) ? next : null;
  if (path === "/partnerships" || path.startsWith("/partnerships/"))
    return canAccessPartnerships(subject.role) ? next : null;
  if (path.startsWith("/onboarding")) return canAccessCreatorArea(subject.role) ? next : null;
  if (MEMBER_AREAS.some((area) => path === area || path.startsWith(`${area}/`))) {
    if (!canAccessCreatorArea(subject.role)) return null;
    // An incomplete creator always resumes onboarding first.
    if (!subject.onboardingComplete) return null;
    return next;
  }
  return null;
}

export function postSignInPath(subject: RoutingSubject, next?: string | null): string {
  return safeNextPath(next, subject) ?? homePathFor(subject);
}
