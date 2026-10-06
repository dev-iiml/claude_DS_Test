import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/cn";

import { Sidebar, TabBar, type NavItem } from "./app-nav";
import { Eyebrow, Lede, PageHeading } from "./heading";
import { Wordmark } from "./wordmark";

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
    >
      Skip to content
    </a>
  );
}

export function ComplianceNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-caption leading-relaxed text-ink-subtle", className)}>
      CreatorCo is a creator membership and technology platform, not a bank or lender. Any financial product will be
      offered by a regulated partner bank or NBFC and is subject to its approval. Pilot build — some information is
      sample data.
    </p>
  );
}

/**
 * Authenticated app frame.
 * - iPhone: compact top bar, large title content, bottom tab bar.
 * - Mac / large screens: macOS-style sidebar with the same destinations.
 */
export function AppShell({
  nav,
  sidebarFooter,
  topBarAction,
  children,
  className,
}: {
  nav: NavItem[];
  sidebarFooter?: React.ReactNode;
  topBarAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh [--footer-safe:0px] [--tabbar-offset:calc(var(--size-tab-bar)+env(safe-area-inset-bottom))] lg:[--tabbar-offset:0px]">
      <SkipLink />
      <Sidebar items={nav} footer={sidebarFooter} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bar-blur pt-safe lg:hidden">
          <div className="flex h-top-bar items-center justify-between px-[max(1rem,env(safe-area-inset-left))]">
            <Wordmark href={nav[0]?.href ?? "/"} className="text-[19px]" />
            {topBarAction}
          </div>
        </header>
        <main
          id="main"
          className={cn(
            "mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-tabbar sm:px-6 lg:max-w-5xl lg:px-10 lg:pt-10 lg:pb-16",
            className,
          )}
        >
          {children}
          <ComplianceNote className="mt-12" />
        </main>
        <TabBar items={nav} />
      </div>
    </div>
  );
}

/** Large-title page header used inside AppShell. */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
        <PageHeading>{title}</PageHeading>
        {description ? <Lede className="mt-2">{description}</Lede> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Sign-in / sign-up: full-screen on iPhone; centred sheet beside a brand panel on Mac. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe lg:grid lg:grid-cols-[1.1fr_1fr]">
      <SkipLink />
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface p-12 lg:flex lg:flex-col lg:justify-between">
        <Wordmark />
        <div className="max-w-md">
          <p className="text-[40px] leading-[1.08] font-bold tracking-[-0.03em] text-balance">
            Your influence opens doors.
            <span className="block text-gold">Your business earns the limit.</span>
          </p>
        </div>
        <p className="text-footnote text-ink-subtle">A professional and financial network for creators in India.</p>
      </aside>
      <main id="main" className="flex flex-1 flex-col px-5 py-6 sm:px-10 lg:justify-center lg:px-16">
        <div className="mb-10 lg:hidden">
          <Wordmark />
        </div>
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <PageHeading>{title}</PageHeading>
          {description ? <Lede className="mt-2">{description}</Lede> : null}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** Onboarding: iOS navigation bar (back + progress), one column, sticky bottom action. */
export function OnboardingShell({
  progress,
  eyebrow,
  title,
  description,
  actions,
  backHref,
  children,
}: {
  progress?: React.ReactNode;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-line bar-blur pt-safe">
        <div className="mx-auto flex h-top-bar w-full max-w-2xl items-center justify-between gap-2 px-[max(0.5rem,env(safe-area-inset-left))] sm:px-4">
          {backHref ? (
            <Link
              href={backHref}
              className="flex h-touch items-center gap-0.5 rounded-full pr-3 pl-1 text-body text-gold"
              aria-label="Back to previous step"
            >
              <ChevronLeft aria-hidden="true" className="size-6" strokeWidth={2.2} />
              Back
            </Link>
          ) : (
            <Wordmark className="ml-2 text-[19px]" />
          )}
          {actions}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 pt-5 pb-10 sm:px-6 sm:pt-8">
        {progress ? <div className="mb-7">{progress}</div> : null}
        {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
        <PageHeading>{title}</PageHeading>
        {description ? <Lede className="mt-2">{description}</Lede> : null}
        <div className="mt-8">{children}</div>
        <ComplianceNote className="mt-14" />
      </main>
    </div>
  );
}

/**
 * Primary form action pinned to the bottom of the screen on iPhone (above the
 * home indicator), inline on larger screens.
 */
export function FormFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky sticky-footer z-20 -mx-4 border-t border-line bar-blur px-4 pt-3",
        "sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none",
        "[&_[data-slot=button]]:w-full sm:[&_[data-slot=button]]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** iOS back button for pushed screens inside AppShell (e.g. Passport → Edit). */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-2 -ml-2 inline-flex h-touch items-center gap-0.5 rounded-full pr-3 pl-1 text-body text-gold"
    >
      <ChevronLeft aria-hidden="true" className="size-6" strokeWidth={2.2} />
      {label}
    </Link>
  );
}
