import Link from "next/link";
import type { Metadata } from "next";

import { CreatorStatusBadge, EmptyState, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { listOpportunitiesForCreator, listRequestsForCreator } from "@/modules/access";
import { ACCESS_REQUEST_STATUS_LABELS, OPPORTUNITY_KIND_LABELS } from "@/modules/access/presentation";
import { getPointsSummary } from "@/modules/rewards/ledger-service";
import { formatPoints } from "@/modules/rewards/rules";

import { requireMember } from "../_lib/member";
import { CreatorShell } from "../_components/creator-shell";

import { availabilityBadge, costLabel, dayMonth, fullDate } from "./_lib/present";

export const metadata: Metadata = { title: "Access" };

export default async function AccessPage() {
  const { user, passport } = await requireMember();
  const db = getDb();
  const [all, requests, points] = await Promise.all([
    listOpportunitiesForCreator(db, { userId: user.userId, creatorId: passport.creatorId }),
    listRequestsForCreator(db, user.userId),
    getPointsSummary(db, passport.creatorId, 0),
  ]);

  // What the creator can act on first; tier-locked and full ones after (each group keeps closing order).
  const rank = (a: string) => (a === "open" || a === "requested" || a === "approved" ? 0 : 1);
  const opportunities = [...all].sort((a, b) => rank(a.availability) - rank(b.availability));

  return (
    <CreatorShell>
      <PageHeader
        title="Access"
        description="Brand programmes, PR and experiences for working creators."
        action={<StatusBadge tone="brand">Preview</StatusBadge>}
      />

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/access/points"
          className="flex items-center justify-between gap-4 rounded-card bg-surface p-5 ring-1 ring-line ring-inset"
        >
          <span>
            <span className="block text-footnote text-ink-muted">Creator Points</span>
            <span className="mt-1 block text-title-2 font-semibold tracking-tight tabular-nums">
              {new Intl.NumberFormat("en-IN").format(points.balance)}
            </span>
            {points.onHold > 0 ? (
              <span className="mt-0.5 block text-footnote text-ink-subtle">
                {formatPoints(points.onHold)} held for requests
              </span>
            ) : null}
          </span>
          <span className="text-subhead text-gold">Points history</span>
        </Link>
        <Link
          href="/passport/status"
          className="flex items-center justify-between gap-4 rounded-card bg-surface p-5 ring-1 ring-line ring-inset"
        >
          <span>
            <span className="block text-footnote text-ink-muted">Creator Status</span>
            <span className="mt-2 block">
              <CreatorStatusBadge tier={passport.tier} />
            </span>
          </span>
          <span className="text-subhead text-gold">How it works</span>
        </Link>
      </div>

      {requests.length ? (
        <ListGroup id="requests" label="Your requests" className="mb-8">
          {requests.map((r) => (
            <ListRow
              key={r.id}
              href={`/access/${r.opportunityId}`}
              label={r.title}
              detail={`${r.brandName} · requested ${dayMonth.format(r.requestedAt)}`}
              accessory={
                <StatusBadge tone={r.status === "approved" ? "success" : r.status === "requested" ? "info" : "neutral"}>
                  {ACCESS_REQUEST_STATUS_LABELS[r.status]}
                </StatusBadge>
              }
            />
          ))}
        </ListGroup>
      ) : null}

      {opportunities.length ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Opportunities">
          {opportunities.map((o) => {
            const badge = availabilityBadge(o);
            return (
              <li key={o.id}>
                <Link
                  href={`/access/${o.id}`}
                  className="flex h-full min-h-[200px] flex-col justify-between gap-4 rounded-card bg-surface p-5 ring-1 ring-line ring-inset"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-footnote font-semibold tracking-[var(--tracking-eyebrow)] text-gold uppercase">
                      {OPPORTUNITY_KIND_LABELS[o.kind]}
                    </p>
                    <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                  </div>
                  <div>
                    <p className="line-clamp-2 text-title-2 leading-tight font-semibold tracking-tight">{o.title}</p>
                    <p className="mt-1 text-subhead text-ink-muted">
                      {o.brand.name}
                      {o.brand.isSample ? " · Sample brand" : ""}
                    </p>
                  </div>
                  <p className="flex items-center justify-between text-footnote text-ink-subtle">
                    <span>{costLabel(o.pointsCost)}</span>
                    <span>Closes {fullDate.format(o.closesAt)}</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="Nothing open right now" description="New opportunities appear here when they open." />
      )}

      <p className="mt-6 max-w-prose text-footnote text-ink-subtle">
        Preview: every brand and opportunity here is a sample. Requests are reviewed by CreatorCo, but nothing is sent
        to a brand and nothing is fulfilled. Creator Points are simulated membership points with no cash value.
      </p>
    </CreatorShell>
  );
}
