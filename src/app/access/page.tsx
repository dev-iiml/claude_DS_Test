import Link from "next/link";
import type { Metadata } from "next";

import { CreatorStatusBadge, EmptyState, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { listOpportunitiesForCreator, listRequestsForCreator } from "@/modules/access";
import {
  ACCESS_SHOW,
  ACCESS_SHOW_LABELS,
  ACCESS_SORTS,
  ACCESS_SORT_LABELS,
  accessBrowseSchema,
  browseOpportunities,
} from "@/modules/access/browse";
import { OPPORTUNITY_KINDS } from "@/modules/access/domain";
import { firstParam } from "@/modules/passport/activity-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { ACCESS_REQUEST_STATUS_LABELS, OPPORTUNITY_KIND_LABELS } from "@/modules/access/presentation";
import { getPointsSummary } from "@/modules/rewards/ledger-service";
import { formatPoints } from "@/modules/rewards/rules";

import { requireMember } from "../_lib/member";
import { CreatorShell } from "../_components/creator-shell";

import { availabilityBadge, costLabel, dayMonth, fullDate } from "./_lib/present";

export const metadata: Metadata = { title: "Access" };

const REQUESTS_SHOWN = 5;

export default async function AccessPage({ searchParams }: PageProps<"/access">) {
  const { user, passport } = await requireMember();
  const db = getDb();
  const [all, requests, points] = await Promise.all([
    listOpportunitiesForCreator(db, { userId: user.userId, creatorId: passport.creatorId }),
    listRequestsForCreator(db, user.userId),
    getPointsSummary(db, passport.creatorId, 0),
  ]);

  const raw = await searchParams;
  const b = accessBrowseSchema.parse({
    q: firstParam(raw.q) || undefined,
    kind: firstParam(raw.kind) || undefined,
    category: firstParam(raw.category) || undefined,
    show: firstParam(raw.show) || undefined,
    sort: firstParam(raw.sort) || undefined,
    page: firstParam(raw.page) || undefined,
  });
  const { items: opportunities, total, categories, pages } = browseOpportunities(all, b);
  const filtered = Boolean(b.q || b.kind || b.category || b.show !== "all");
  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    if (b.q) p.set("q", b.q);
    if (b.kind) p.set("kind", b.kind);
    if (b.category) p.set("category", b.category);
    if (b.show !== "all") p.set("show", b.show);
    if (b.sort !== "recommended") p.set("sort", b.sort);
    if (page > 1) p.set("page", String(page));
    const qs = p.toString();
    return qs ? `/access?${qs}` : "/access";
  };

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
          {requests.slice(0, REQUESTS_SHOWN).map((r) => (
            <ListRow
              key={r.id}
              href={`/access/${r.opportunityId}`}
              label={r.title}
              detail={`${r.brandName} · requested ${dayMonth.format(r.requestedAt)}`}
              accessory={
                <StatusBadge tone={r.status === "approved" ? "success" : r.status === "requested" ? "info" : "neutral"}>
                  {r.status === "approved" && r.completedAt ? "Completed" : ACCESS_REQUEST_STATUS_LABELS[r.status]}
                </StatusBadge>
              }
            />
          ))}
        </ListGroup>
      ) : null}

      <form
        method="get"
        action="/access"
        role="search"
        aria-label="Filter opportunities"
        className="mb-6 grid grid-cols-2 gap-3 rounded-card bg-surface p-4 ring-1 ring-line ring-inset sm:grid-cols-3 lg:grid-cols-6"
      >
        <label className="col-span-2 flex flex-col gap-1 sm:col-span-3 lg:col-span-2">
          <span className="text-footnote text-ink-muted">Search</span>
          <Input name="q" defaultValue={b.q ?? ""} placeholder="Brand, title or category" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-ink-muted">Type</span>
          <NativeSelect name="kind" defaultValue={b.kind ?? ""}>
            <option value="">All types</option>
            {OPPORTUNITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {OPPORTUNITY_KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-ink-muted">Category</span>
          <NativeSelect name="category" defaultValue={b.category ?? ""}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-ink-muted">Show</span>
          <NativeSelect name="show" defaultValue={b.show}>
            {ACCESS_SHOW.map((v) => (
              <option key={v} value={v}>
                {ACCESS_SHOW_LABELS[v]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-ink-muted">Sort by</span>
          <NativeSelect name="sort" defaultValue={b.sort}>
            {ACCESS_SORTS.map((v) => (
              <option key={v} value={v}>
                {ACCESS_SORT_LABELS[v]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-3 lg:col-span-6">
          <p className="text-footnote text-ink-subtle" aria-live="polite">
            {total} {total === 1 ? "opportunity" : "opportunities"}
            {filtered ? " match" : ""}
          </p>
          <div className="flex items-center gap-3">
            {filtered || b.sort !== "recommended" ? (
              <Link href="/access" className="text-subhead text-gold">
                Clear
              </Link>
            ) : null}
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
          </div>
        </div>
      </form>

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
      ) : null}
      {opportunities.length && pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-subhead">
          {b.page > 1 ? (
            <Link href={pageHref(b.page - 1)} className="text-gold">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-subtle">
            Page {Math.min(b.page, pages)} of {pages}
          </span>
          {b.page < pages ? (
            <Link href={pageHref(b.page + 1)} className="text-gold">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
      {opportunities.length === 0 ? (
        <EmptyState
          title={filtered ? "Nothing matches these filters" : "Nothing open right now"}
          description={
            filtered
              ? "Try another type or category, or clear the filters."
              : "New opportunities appear here when they open."
          }
        />
      ) : null}

      <p className="mt-6 max-w-prose text-footnote text-ink-subtle">
        Preview: every brand and opportunity here is a sample. Requests are reviewed by CreatorCo, but nothing is sent
        to a brand and nothing is fulfilled. Creator Points are simulated membership points with no cash value.
      </p>
    </CreatorShell>
  );
}
