import Link from "next/link";

import { ComplianceNote, DisplayHeading, Eyebrow, Lede, Wordmark } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { getCurrentUser, homePathForUser } from "@/modules/identity";

import { recordAfterResponse } from "./_lib/analytics";

const PILLARS = [
  {
    kicker: "Identity",
    title: "Creator Passport",
    body: "A verified professional identity for the business you've built.",
  },
  {
    kicker: "Finance",
    title: "Financial eligibility",
    body: "Assessed on creator economics. Decisions by regulated partners.",
  },
  { kicker: "Access", title: "Programmes & PR", body: "Brand programmes, PR and experiences for working creators." },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  const home = user ? await homePathForUser(user) : null;
  // Anonymous funnel count for signed-out visitors (no identifier). Campaign tags, if any: see proxy.ts.
  if (!user) await recordAfterResponse({ event: "landing_viewed" });

  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-[max(1.25rem,env(safe-area-inset-left))] sm:px-8">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-1">
          {home ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={home}>Continue</Link>
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </nav>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pt-14 pb-10 sm:px-8 lg:justify-center lg:pt-10"
      >
        <Eyebrow>Membership by application · India</Eyebrow>
        <DisplayHeading className="mt-4 max-w-3xl">
          Your influence opens doors.
          <span className="block text-gold">Your business earns the limit.</span>
        </DisplayHeading>
        <Lede className="mt-6">
          A professional and financial network for creators — recognising the business you&rsquo;ve built, not just your
          follower count.
        </Lede>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="sm:w-auto">
            <Link href="/signup">Apply for membership</Link>
          </Button>
          {!home ? (
            <Button asChild size="lg" variant="secondary" className="sm:w-auto">
              <Link href="/login">I&rsquo;m a member</Link>
            </Button>
          ) : null}
        </div>

        <ul className="mt-16 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PILLARS.map((p) => (
            <li key={p.title} className="rounded-card bg-surface p-5 ring-1 ring-line ring-inset">
              <p className="text-footnote font-semibold tracking-[var(--tracking-eyebrow)] text-gold uppercase">
                {p.kicker}
              </p>
              <p className="mt-3 text-title-3 font-semibold tracking-tight">{p.title}</p>
              <p className="mt-1.5 text-subhead leading-snug text-ink-muted">{p.body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-5 pb-8 sm:px-8">
        <ComplianceNote />
      </footer>
    </div>
  );
}
