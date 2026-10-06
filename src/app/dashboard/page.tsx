import Link from "next/link";
import type { Metadata } from "next";

import {
  CreatorStatusBadge,
  ListGroup,
  ListRow,
  MembershipCard,
  PageHeader,
  ProgressMeter,
  SectionHeading,
  StatusBadge,
} from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { SAMPLE_OPPORTUNITIES } from "@/modules/access/sample-opportunities";
import { getCreatorDashboard } from "@/modules/creator-profile/queries";
import { getOpenApplication, listApplications } from "@/modules/financial-eligibility/application-service";
import { getCreatorLenderView } from "@/modules/lending";
import { FEATURE_COPY, formatFeatureValue } from "@/modules/professional-graph/presentation";

import { requireMember } from "../_lib/member";
import { lenderBadge } from "../eligibility/_lib/lender-badge";
import { CreatorShell } from "../_components/creator-shell";

export const metadata: Metadata = { title: "Home" };

const HIGHLIGHTS = ["professional_longevity_months", "total_audience", "engagement_rate_3m"] as const;

export default async function HomePage({ searchParams }: PageProps<"/dashboard">) {
  const { user, passport } = await requireMember();
  const view = await getCreatorDashboard(getDb(), user.userId);
  const openCheck = await getOpenApplication({ db: getDb() }, user.userId);
  // Without an open check, the latest check shared with a partner lender (its decision, once reviewed).
  const sentCheck = openCheck
    ? null
    : ((await listApplications(getDb(), user.userId)).find((a) => a.status === "submitted") ?? null);
  const sentBadge = sentCheck
    ? lenderBadge(await getCreatorLenderView(getDb(), { userId: user.userId, applicationId: sentCheck.id }))
    : null;
  const { welcome } = await searchParams;

  const connected = passport.accounts.filter((a) => a.status === "connected").length;
  const nextSteps = [
    connected === 0 && {
      href: "/passport/connect",
      label: "Connect a social account",
      detail: "Verifies your creator activity.",
    },
    !passport.consents.professionalAnalytics && {
      href: "/passport/signals",
      label: "Turn on professional signals",
      detail: "Optional. See how your creator business is trending.",
    },
    view &&
      view.completion.percent < 100 && {
        href: "/passport",
        label: "Complete your Passport",
        detail: `${view.completion.percent}% complete`,
      },
  ].filter((s): s is { href: string; label: string; detail: string } => Boolean(s));

  const highlights = passport.graph
    ? HIGHLIGHTS.map((key) => {
        const f = passport.graph!.features.find((x) => x.key === key);
        return { key, label: FEATURE_COPY[key].label, value: formatFeatureValue(key, f?.value ?? null) };
      })
    : null;

  return (
    <CreatorShell>
      <PageHeader eyebrow="Welcome back" title={passport.displayName} />

      {welcome ? (
        <Alert tone="success" className="mb-6">
          Your Creator Professional Profile is complete. Welcome to CreatorCo.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start">
        <div className="flex flex-col gap-4">
          <Link href="/passport" aria-label="Open your Creator Passport" className="block rounded-xl">
            <MembershipCard
              displayName={passport.displayName}
              handle={passport.handle}
              tier={passport.tier}
              memberSince={passport.memberSince}
              memberNumber={passport.memberNumber}
            />
          </Link>
          {view ? (
            <div className="flex items-center gap-4 px-1">
              <ProgressMeter value={view.completion.percent} label="Passport completion" className="flex-1" />
              <span className="text-footnote text-ink-muted tabular-nums">{view.completion.percent}% complete</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-8">
          {nextSteps.length ? (
            <ListGroup id="next" label="Next steps">
              {nextSteps.map((s) => (
                <ListRow key={s.href} href={s.href} label={s.label} detail={s.detail} />
              ))}
            </ListGroup>
          ) : null}

          {highlights ? (
            <ListGroup
              id="signals"
              label="Professional signals"
              action={
                <Link href="/passport/signals" className="text-subhead text-gold">
                  See all
                </Link>
              }
              footer="About your creator business — not a credit score."
            >
              {highlights.map((h) => (
                <ListRow key={h.key} label={h.label} value={h.value} />
              ))}
            </ListGroup>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Creator Status</CardTitle>
              <CreatorStatusBadge tier={passport.tier} />
            </div>
            <CardDescription>Your professional standing in the network.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-subhead text-ink-muted">
              Status reflects your creator career and participation. It never sets financial limits.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Financial eligibility</CardTitle>
              {openCheck ? (
                <StatusBadge tone={openCheck.status === "inputs_ready" ? "success" : "info"}>
                  {openCheck.status === "inputs_ready" ? "Check complete" : "In progress"}
                </StatusBadge>
              ) : sentBadge ? (
                <StatusBadge tone={sentBadge.tone}>{sentBadge.label}</StatusBadge>
              ) : null}
            </div>
            <CardDescription>Optional, with its own separate consent.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <p className="text-subhead text-ink-muted">
              Any eligibility shown will be a CreatorCo recommendation, subject to partner-lender approval.
            </p>
            <Button asChild variant="secondary" size="sm">
              {sentCheck && sentBadge ? (
                <Link href={`/eligibility/${sentCheck.id}`}>
                  {sentBadge.label === "Offer ready"
                    ? "View your offer"
                    : sentBadge.actionable
                      ? "View the decision"
                      : "View your check"}
                </Link>
              ) : (
                <Link href="/eligibility">{openCheck ? "Continue your check" : "Check financial eligibility"}</Link>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="access-heading" className="mt-10">
        <div className="mb-3 flex items-end justify-between gap-3">
          <SectionHeading id="access-heading">Access</SectionHeading>
          <Link href="/access" className="text-subhead text-gold">
            See all
          </Link>
        </div>
        <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
          {SAMPLE_OPPORTUNITIES.map((o) => (
            <li
              key={o.id}
              className="w-[72%] shrink-0 snap-start rounded-card bg-surface p-5 ring-1 ring-line ring-inset sm:w-auto"
            >
              <p className="text-footnote font-semibold tracking-[var(--tracking-eyebrow)] text-gold uppercase">
                {o.kind}
              </p>
              <p className="mt-3 text-title-3 leading-tight font-semibold tracking-tight">{o.title}</p>
              <p className="mt-1 text-subhead text-ink-muted">{o.category}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-footnote text-ink-subtle">Sample preview — not live opportunities.</p>
      </section>
    </CreatorShell>
  );
}
