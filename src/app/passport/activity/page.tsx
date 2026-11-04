import Link from "next/link";
import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader } from "@/components/creatorco";
import { getDb } from "@/db";
import { cn } from "@/lib/cn";
import { activityQuerySchema, firstParam } from "@/modules/passport/activity-query";
import {
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS,
  ACTIVITY_PAGE_SIZE,
  listActivity,
} from "@/modules/passport/passport-view";

import { requireMember } from "../../_lib/member";
import { CreatorShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Activity" };

const when = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function chip(active: boolean) {
  return cn(
    "inline-flex h-9 items-center rounded-full px-4 text-subhead ring-1 ring-inset",
    active ? "bg-elevated text-ink ring-gold" : "bg-surface text-ink-muted ring-line hover:bg-elevated",
  );
}

export default async function ActivityPage({ searchParams }: PageProps<"/passport/activity">) {
  const { user, passport } = await requireMember();
  const raw = await searchParams;
  const q = activityQuerySchema.parse({
    kind: firstParam(raw.kind),
    sort: firstParam(raw.sort),
    page: firstParam(raw.page),
  });
  const { items, hasMore } = await listActivity(getDb(), {
    userId: user.userId,
    creatorId: passport.creatorId,
    accountIds: passport.accounts.map((a) => a.id),
    kind: q.kind,
    order: q.sort,
    limit: ACTIVITY_PAGE_SIZE,
    offset: (q.page - 1) * ACTIVITY_PAGE_SIZE,
  });
  const href = (next: Partial<{ kind: string | undefined; sort: string; page: number }>) => {
    const p = new URLSearchParams();
    const merged = { kind: q.kind, sort: q.sort, page: 1, ...next };
    if (merged.kind) p.set("kind", merged.kind);
    if (merged.sort !== "newest") p.set("sort", merged.sort);
    if (merged.page > 1) p.set("page", String(merged.page));
    const s = p.toString();
    return s ? `/passport/activity?${s}` : "/passport/activity";
  };

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageHeader title="Activity" description="Everything you've done on your Passport, newest first by default." />
      <div className="flex max-w-2xl flex-col gap-6">
        <nav
          aria-label="Filter activity"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          <Link href={href({ kind: undefined })} className={chip(!q.kind)} aria-current={!q.kind ? "page" : undefined}>
            All
          </Link>
          {ACTIVITY_KINDS.map((k) => (
            <Link
              key={k}
              href={href({ kind: k })}
              className={chip(q.kind === k)}
              aria-current={q.kind === k ? "page" : undefined}
            >
              {ACTIVITY_KIND_LABELS[k]}
            </Link>
          ))}
        </nav>
        <nav aria-label="Sort activity" className="flex items-center gap-3 px-1 text-subhead">
          <span className="text-ink-muted">Sort:</span>
          <Link
            href={href({ sort: "newest" })}
            className={q.sort === "newest" ? "font-semibold text-ink" : "text-gold"}
            aria-current={q.sort === "newest" ? "page" : undefined}
          >
            Newest first
          </Link>
          <Link
            href={href({ sort: "oldest" })}
            className={q.sort === "oldest" ? "font-semibold text-ink" : "text-gold"}
            aria-current={q.sort === "oldest" ? "page" : undefined}
          >
            Oldest first
          </Link>
        </nav>

        <ListGroup id="activity-list" label={q.kind ? ACTIVITY_KIND_LABELS[q.kind] : "All activity"}>
          {items.length === 0 ? (
            <ListRow label="Nothing here yet" />
          ) : (
            items.map((a) => (
              <ListRow
                key={a.id}
                label={a.label}
                detail={ACTIVITY_KIND_LABELS[a.kind]}
                value={
                  <time dateTime={a.at} className="text-subhead whitespace-nowrap">
                    {when.format(new Date(a.at))}
                  </time>
                }
              />
            ))
          )}
        </ListGroup>

        {q.page > 1 || hasMore ? (
          <nav aria-label="Pages" className="flex items-center justify-between px-1 text-subhead">
            {q.page > 1 ? (
              <Link href={href({ page: q.page - 1 })} className="text-gold">
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-subtle">Page {q.page}</span>
            {hasMore ? (
              <Link href={href({ page: q.page + 1 })} className="text-gold">
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </CreatorShell>
  );
}
