import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { cn } from "@/lib/cn";
import { QUEUE_FILTERS, listQueue, type QueueFilter } from "@/modules/brand-work";
import { REVIEW_SLA_HOURS } from "@/modules/brand-work/domain";
import { VERIFICATION_STATUS_COPY } from "@/modules/brand-work/presentation";
import { requireBrandWorkReviewer } from "@/modules/identity";

import { BrandWorkShell } from "../_components/creator-shell";

export const metadata: Metadata = { title: "Brand work review" };

const FILTER_LABELS: Record<QueueFilter, string> = {
  to_review: "To review",
  second_review: "Second review",
  waiting_scan: "Checking files",
  needs_info: "Waiting on creator",
  verified: "Verified",
  rejected: "Not verified",
};

const NOTICES: Record<string, string> = {
  own_record: "You can't review your own records.",
  wrong_state: "That document hasn't passed scanning yet.",
  storage_unavailable: "Document storage isn't available right now.",
  not_found: "That document no longer exists.",
};

export default async function BrandWorkQueuePage({ searchParams }: PageProps<"/brand-work">) {
  const staff = await requireBrandWorkReviewer();
  const q = await searchParams;
  const filter = QUEUE_FILTERS.find((f) => f === q.filter) ?? "to_review";
  const flaggedOnly = q.flagged === "1";
  const rows = await listQueue(getDb(), { reviewerId: staff.userId, filter, flaggedOnly });
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;
  const href = (f: QueueFilter, flagged = flaggedOnly) => `/brand-work?filter=${f}${flagged ? "&flagged=1" : ""}`;

  return (
    <BrandWorkShell role={staff.role}>
      <PageHeader
        eyebrow="Internal · verified brand work"
        title="Review queue"
        description={`Check each record against its documents. Flagged records need a second reviewer. Records waiting more than ${REVIEW_SLA_HOURS} hours are marked.`}
      />
      {notice ? (
        <Alert tone="warning" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      <nav aria-label="Queue" className="mb-4 flex flex-wrap gap-2">
        {QUEUE_FILTERS.map((f) => (
          <Link
            key={f}
            href={href(f)}
            aria-current={f === filter ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-4 text-subhead ring-1 ring-inset",
              f === filter ? "bg-elevated text-ink ring-gold" : "bg-surface text-ink-muted ring-line hover:bg-elevated",
            )}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
        <Link href={href(filter, !flaggedOnly)} className="inline-flex h-9 items-center px-2 text-subhead text-gold">
          {flaggedOnly ? "Show all" : "Flagged only"}
        </Link>
      </nav>
      <ListGroup
        id="queue"
        label={FILTER_LABELS[filter]}
        footer="Creator-professional data and documents only — never financial data."
      >
        {rows.length ? (
          rows.map((r) => (
            <ListRow
              key={r.id}
              href={`/brand-work/records/${r.id}`}
              label={`${r.creatorName} · ${r.endBrandName}`}
              detail={[
                r.ageHours !== null
                  ? `waiting ${r.ageHours < 24 ? `${r.ageHours}h` : `${Math.floor(r.ageHours / 24)}d`}`
                  : null,
                r.flags.length ? `${r.flags.length} flag${r.flags.length === 1 ? "" : "s"}` : null,
                r.awaitingSecond ? "awaiting second review" : null,
                r.brandResolved ? null : "brand to confirm",
                r.assignedToOther ? "open with another reviewer" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              accessory={
                r.overSla ? (
                  <StatusBadge tone="warning">Over {REVIEW_SLA_HOURS}h</StatusBadge>
                ) : (
                  <StatusBadge tone={VERIFICATION_STATUS_COPY[r.status].tone}>
                    {VERIFICATION_STATUS_COPY[r.status].label}
                  </StatusBadge>
                )
              }
            />
          ))
        ) : (
          <ListRow label="Nothing here" />
        )}
      </ListGroup>
    </BrandWorkShell>
  );
}
