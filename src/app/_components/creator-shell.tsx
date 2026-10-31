import { AppShell } from "@/components/creatorco";
import type { NavItem } from "@/components/creatorco/app-nav";
import type { UserRole } from "@/modules/identity/domain";

import { SignOutForm } from "./sign-out-form";

export const CREATOR_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/passport", label: "Passport", icon: "passport" },
  { href: "/access", label: "Access", icon: "access" },
  { href: "/account", label: "Account", icon: "account" },
];

export function CreatorShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={CREATOR_NAV} sidebarFooter={<SignOutForm />}>
      {children}
    </AppShell>
  );
}

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "console" },
  { href: "/admin/underwriting", label: "Underwriting", icon: "underwriting" },
  { href: "/admin/proposals", label: "Proposals", icon: "approvals" },
  // Reuses an existing icon: a dedicated one would be a design-system change (pinned v2.0.0).
  { href: "/admin/models", label: "Models & rules", icon: "underwriting" },
  { href: "/insights", label: "Analytics", icon: "console" },
];

export const OPS_NAV: NavItem[] = [
  { href: "/ops", label: "Integrations", icon: "integrations" },
  // Reuses an existing icon: a dedicated one would be a design-system change (pinned v2.0.0).
  { href: "/ops/partners", label: "Partners", icon: "integrations" },
  { href: "/ops/changes", label: "Approvals", icon: "approvals" },
  { href: "/ops/jobs", label: "Jobs", icon: "jobs" },
];

export const PARTNERSHIPS_NAV: NavItem[] = [
  { href: "/partnerships", label: "Requests", icon: "approvals" },
  { href: "/partnerships/opportunities", label: "Opportunities", icon: "access" },
  // Reuses an existing icon: a dedicated one would be a design-system change (pinned v2.0.0).
  { href: "/partnerships/tasks", label: "Points tasks", icon: "approvals" },
];

/** How other consoles link to the brand-work review desk (super admins only). */
const BRAND_WORK_LINK: NavItem = { href: "/brand-work", label: "Brand work", icon: "approvals" };

/** How other consoles link to the partnerships desk (super admins only). */
const PARTNERSHIPS_LINK: NavItem = { href: "/partnerships", label: "Partnerships", icon: "access" };

/** Super admins see every console; everyone else only their own. */
export function AdminShell({ children, role }: { children: React.ReactNode; role?: UserRole }) {
  const nav = role === "super_admin" ? [...ADMIN_NAV, OPS_NAV[0]!, PARTNERSHIPS_LINK, BRAND_WORK_LINK] : ADMIN_NAV;
  return (
    <AppShell nav={nav} sidebarFooter={<SignOutForm />} topBarAction={<SignOutForm />}>
      {children}
    </AppShell>
  );
}

export function OpsShell({ children, role }: { children: React.ReactNode; role?: UserRole }) {
  const nav = role === "super_admin" ? [...OPS_NAV, ADMIN_NAV[0]!, PARTNERSHIPS_LINK] : OPS_NAV;
  return (
    <AppShell nav={nav} sidebarFooter={<SignOutForm />} topBarAction={<SignOutForm />}>
      {children}
    </AppShell>
  );
}

/** The brand partnerships desk (Access requests and opportunities). */
export function PartnershipsShell({ children, role }: { children: React.ReactNode; role?: UserRole }) {
  const nav = role === "super_admin" ? [...PARTNERSHIPS_NAV, ADMIN_NAV[0]!, OPS_NAV[0]!] : PARTNERSHIPS_NAV;
  return (
    <AppShell nav={nav} sidebarFooter={<SignOutForm />} topBarAction={<SignOutForm />}>
      {children}
    </AppShell>
  );
}

// Reuses existing icons: dedicated ones would be a design-system change (pinned v2.0.0).
export const BRAND_WORK_NAV: NavItem[] = [
  { href: "/brand-work", label: "Review queue", icon: "approvals" },
  { href: "/brand-work/reversals", label: "Reversals", icon: "approvals" },
  { href: "/brand-work/directory", label: "Brand directory", icon: "access" },
];

/** Verified brand work review (Stage 18): its own least-privilege role. */
export function BrandWorkShell({ children, role }: { children: React.ReactNode; role?: UserRole }) {
  const nav =
    role === "super_admin" ? [...BRAND_WORK_NAV, ADMIN_NAV[0]!, OPS_NAV[0]!, PARTNERSHIPS_LINK] : BRAND_WORK_NAV;
  return (
    <AppShell nav={nav} sidebarFooter={<SignOutForm />} topBarAction={<SignOutForm />}>
      {children}
    </AppShell>
  );
}

export const INSIGHTS_NAV: NavItem[] = [
  { href: "/insights", label: "Funnel", icon: "console" },
  { href: "/insights/brand-work", label: "Brand work", icon: "console" },
  // Reuses an existing icon: a dedicated one would be a design-system change (pinned v2.0.0).
  { href: "/insights/models", label: "Models", icon: "underwriting" },
];

/** Aggregate analytics. Risk and super admins also get a way back to the risk console. */
export function InsightsShell({ children, role }: { children: React.ReactNode; role?: UserRole }) {
  const nav = role === "analyst" ? INSIGHTS_NAV : [...INSIGHTS_NAV, { ...ADMIN_NAV[0]!, label: "Risk console" }];
  return (
    <AppShell nav={nav} sidebarFooter={<SignOutForm />} topBarAction={<SignOutForm />}>
      {children}
    </AppShell>
  );
}
