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
];

export const OPS_NAV: NavItem[] = [
  { href: "/ops", label: "Integrations", icon: "integrations" },
  // Reuses an existing icon: a dedicated one would be a design-system change (pinned v2.0.0).
  { href: "/ops/partners", label: "Partners", icon: "integrations" },
  { href: "/ops/changes", label: "Approvals", icon: "approvals" },
  { href: "/ops/jobs", label: "Jobs", icon: "jobs" },
];

/** Super admins see both consoles; everyone else only their own. */
export function AdminShell({ children, role }: { children: React.ReactNode; role?: UserRole }) {
  const nav = role === "super_admin" ? [...ADMIN_NAV, OPS_NAV[0]!] : ADMIN_NAV;
  return (
    <AppShell nav={nav} sidebarFooter={<SignOutForm />} topBarAction={<SignOutForm />}>
      {children}
    </AppShell>
  );
}

export function OpsShell({ children, role }: { children: React.ReactNode; role?: UserRole }) {
  const nav = role === "super_admin" ? [...OPS_NAV, ADMIN_NAV[0]!] : OPS_NAV;
  return (
    <AppShell nav={nav} sidebarFooter={<SignOutForm />} topBarAction={<SignOutForm />}>
      {children}
    </AppShell>
  );
}
