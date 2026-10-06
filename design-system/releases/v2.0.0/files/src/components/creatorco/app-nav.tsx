"use client";

import {
  CircleUser,
  ClipboardCheck,
  Clock,
  House,
  IdCard,
  Plug,
  Scale,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { Wordmark } from "./wordmark";

export type NavIcon =
  "home" | "passport" | "access" | "account" | "console" | "underwriting" | "integrations" | "approvals" | "jobs";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  passport: IdCard,
  access: Sparkles,
  account: CircleUser,
  console: ShieldCheck,
  underwriting: Scale,
  integrations: Plug,
  approvals: ClipboardCheck,
  jobs: Clock,
};

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

/** The most specific nav item matching the path (so /admin/underwriting doesn't also light up /admin). */
function activeHref(pathname: string, items: NavItem[]) {
  return items
    .map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** iPhone: bottom tab bar (translucent, safe-area aware). Hidden on large screens. */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bar-blur pr-safe pb-safe pl-safe lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = activeHref(pathname, items) === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-choice-row flex-col items-center justify-center gap-1 pt-1.5 pb-1 text-caption-2 font-medium transition-colors",
                  active ? "text-gold" : "text-ink-subtle hover:text-ink-muted",
                )}
              >
                <Icon aria-hidden="true" className="size-6" strokeWidth={active ? 2.2 : 1.8} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mac / large screens: source-list sidebar like macOS apps. */
export function Sidebar({ items, footer }: { items: NavItem[]; footer?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-sidebar shrink-0 flex-col border-r border-line bg-surface/60 px-3 py-5 lg:flex">
      <div className="px-3 pb-6">
        <Wordmark href={items[0]?.href ?? "/"} />
      </div>
      <nav aria-label="Primary" className="flex-1">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = activeHref(pathname, items) === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-3 rounded-sm px-3 text-subhead font-medium transition-colors",
                    active ? "bg-elevated text-ink" : "text-ink-muted hover:bg-elevated/60 hover:text-ink",
                  )}
                >
                  <Icon aria-hidden="true" className={cn("size-[18px]", active && "text-gold")} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {footer ? <div className="border-t border-line px-1 pt-4">{footer}</div> : null}
    </aside>
  );
}
