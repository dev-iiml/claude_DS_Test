import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow, MetricBlock, PageHeader, ProgressMeter } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { analyticsDay } from "@/modules/analytics";
import { COHORT_MILESTONES, getAcquisition, getFunnel, getWeeklyCohorts } from "@/modules/analytics/funnel";
import { MIN_CELL, formatPct, formatSuppressed } from "@/modules/analytics/suppression";
import { requireInsightsViewer } from "@/modules/identity";

import { InsightsShell } from "../_components/creator-shell";

export const metadata: Metadata = { title: "Funnel" };

const PERIODS = [7, 30, 90] as const;

export default async function FunnelPage({ searchParams }: PageProps<"/insights">) {
  const viewer = await requireInsightsViewer();
  const q = await searchParams;
  const days = PERIODS.find((p) => String(p) === q.days) ?? 30;
  // Test accounts can be included by risk and super admins only (analysts see real creators only).
  const canIncludeInternal = viewer.role !== "analyst";
  const includeInternal = canIncludeInternal && q.internal === "1";
  const now = new Date();
  const toDay = analyticsDay(now);
  const fromDay = analyticsDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const db = getDb();
  const [funnel, cohorts, acquisition] = await Promise.all([
    getFunnel(db, { fromDay, toDay, includeInternal }),
    getWeeklyCohorts(db, { weeks: 8, today: toDay, includeInternal }),
    getAcquisition(db, { fromDay, toDay, includeInternal }),
  ]);
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { days: String(days), internal: includeInternal ? "1" : null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/insights?${p.toString()}`;
  };

  return (
    <InsightsShell role={viewer.role}>
      <PageHeader
        eyebrow={`Internal · ${getServerEnv().APP_ENV} · aggregates only`}
        title="Creator funnel"
        description={`Creators whose account was created ${fromDay} – ${toDay} (India time), and how far they've got since. Pseudonymous, first-party events; counts under ${MIN_CELL} are hidden.`}
      />

      <nav aria-label="Period" className="mb-6 flex flex-wrap items-center gap-2 text-subhead">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={link({ days: String(p) })}
            aria-current={p === days ? "page" : undefined}
            className={p === days ? "rounded-full bg-elevated px-3 py-1 font-semibold" : "px-3 py-1 text-gold"}
          >
            Last {p} days
          </Link>
        ))}
        {canIncludeInternal ? (
          <Link href={link({ internal: includeInternal ? null : "1" })} className="ml-auto px-3 py-1 text-gold">
            {includeInternal ? "Exclude test accounts" : "Include test accounts"}
          </Link>
        ) : null}
      </nav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Landing page renders",
            value: formatSuppressed(funnel.landingViews),
            hint: "Signed-out, anonymous (includes bots)",
          },
          {
            label: "Applications started",
            value: formatSuppressed(funnel.applicationStarts),
            hint: "Join page opened",
          },
          { label: "Accounts created", value: formatSuppressed(funnel.steps[0]!.creators), hint: "This cohort" },
          {
            label: "Reached an offer",
            value: formatPct(funnel.steps.find((s) => s.event === "offer_generated")?.ofCohortPct ?? null),
            hint: "Share of the cohort",
          },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <MetricBlock label={m.label} value={m.value} hint={m.hint} />
            </CardContent>
          </Card>
        ))}
      </div>

      <ListGroup
        id="funnel"
        label="Funnel"
        className="mt-8"
        footer="Each step counts creators from this cohort who reached it at any time since. Steps aren't strictly ordered — e.g. Access can come before eligibility."
      >
        {funnel.steps.map((s, i) => (
          <ListRow
            key={s.event}
            label={s.label}
            detail={
              <span className="flex flex-col gap-1.5">
                <span>
                  {i === 0
                    ? "Cohort"
                    : `${formatPct(s.ofCohortPct)} of cohort · ${formatPct(s.fromPreviousPct)} of previous step`}
                </span>
                {i > 0 && s.ofCohortPct !== null ? (
                  <ProgressMeter value={s.ofCohortPct} label={`${s.label}: share of cohort`} className="max-w-xs" />
                ) : null}
              </span>
            }
            value={<span className="tabular-nums">{formatSuppressed(s.creators)}</span>}
          />
        ))}
      </ListGroup>

      <ListGroup
        id="cohorts"
        label="Weekly cohorts"
        className="mt-8"
        footer={`Week the account was created (Monday, India time). Shares are hidden when a cohort or step has fewer than ${MIN_CELL} creators.`}
      >
        {cohorts.length ? (
          cohorts.map((c) => (
            <ListRow
              key={c.week}
              label={`Week of ${c.week}`}
              detail={COHORT_MILESTONES.map((m) => `${m.label} ${formatPct(c.reached[m.event] ?? null)}`).join(" · ")}
              value={<span className="tabular-nums">{formatSuppressed(c.size)}</span>}
            />
          ))
        ) : (
          <ListRow label="No sign-ups yet" detail="Cohorts appear once accounts are created." />
        )}
      </ListGroup>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {(
          [
            { id: "source", label: "Sign-ups by source", rows: acquisition.source, none: "Untagged" },
            { id: "medium", label: "Sign-ups by medium", rows: acquisition.medium, none: "Untagged" },
            { id: "campaign", label: "Sign-ups by campaign", rows: acquisition.campaign, none: "Untagged" },
            {
              id: "referrer",
              label: "Sign-ups by referring site",
              rows: acquisition.referrer,
              none: "Direct or unknown",
            },
          ] as const
        ).map((d) => (
          <ListGroup key={d.id} id={`acquisition-${d.id}`} label={d.label}>
            {d.rows.length ? (
              d.rows.map((r) => (
                <ListRow
                  key={r.value}
                  label={r.value === "(none)" ? d.none : r.value}
                  value={<span className="tabular-nums">{formatSuppressed(r.creators)}</span>}
                />
              ))
            ) : (
              <ListRow label="No sign-ups in this period" />
            )}
          </ListGroup>
        ))}
      </div>
      <p className="mt-3 max-w-prose text-footnote text-ink-subtle">
        From the campaign tags on the link a creator arrived from (utm_source / utm_medium / utm_campaign) and the kind
        of site that referred them — search, social or other, never the address. Values with fewer than {MIN_CELL}{" "}
        sign-ups are grouped together.
      </p>

      <p className="mt-6 max-w-prose text-footnote text-ink-subtle">
        Funnel steps are essential, pseudonymous service measurement; screen views (offer and opportunity views) are
        recorded only with the optional Product analytics consent. No names, contact details or financial data are
        recorded. Raw events are kept 24 months, then only daily totals.
      </p>
    </InsightsShell>
  );
}
