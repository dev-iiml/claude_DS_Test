import type { Metadata } from "next";

import { ListGroup, ListRow, MetricBlock, PageHeader, StatusBadge } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireAdmin } from "@/modules/identity";
import { lendingQueueCounts, listProposals } from "@/modules/lending";
import { DECISION_LABELS, PROPOSAL_STATUS_LABELS } from "@/modules/lending/presentation";

import { AdminShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Proposals" };

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const QUEUE = {
  needs_release: { label: "Needs release", tone: "warning" },
  needs_review: { label: "Needs review", tone: "warning" },
  queried: { label: "Query open", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  in_progress: { label: "In progress", tone: "info" },
  reviewed: { label: "Reviewed", tone: "success" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
} as const;

export default async function ProposalsPage() {
  const admin = await requireAdmin();
  const db = getDb();
  const [counts, proposals] = await Promise.all([lendingQueueCounts(db), listProposals(db)]);
  const groups = [
    { key: "needs_release", label: "Held for fraud review", footer: "Released only by a risk admin, with a reason." },
    {
      key: "needs_review",
      label: "Lender decided — awaiting your review",
      footer: "Creators see a decision only after it's confirmed (or, for the simulated lender, overridden).",
    },
    {
      key: "queried",
      label: "Query open with the partner lender",
      footer: "Waiting for the partner to answer with a revised or reaffirmed decision.",
    },
    { key: "failed", label: "Failed to send" },
    { key: "in_progress", label: "In progress" },
    { key: "reviewed", label: "Reviewed" },
    { key: "withdrawn", label: "Withdrawn before sending" },
  ] as const;

  return (
    <AdminShell role={admin.role}>
      <PageHeader
        eyebrow="Partner lenders · simulated lender or partner API"
        title="Credit proposals"
        description="Confirmed checks that creators chose to share. The partner lender decides; a risk admin confirms it (or queries a partner's decision) before the creator sees the outcome."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["needs_release", "needs_review", "failed", "reviewed"] as const).map((k) => (
          <Card key={k}>
            <CardContent className="p-4">
              <MetricBlock label={QUEUE[k].label} value={counts[k]} />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-8">
        {groups.map((g) => {
          const rows = proposals.filter((p) => p.queue === g.key);
          if (!rows.length && (g.key === "withdrawn" || g.key === "failed" || g.key === "queried")) return null;
          return (
            <ListGroup key={g.key} id={`queue-${g.key}`} label={g.label} footer={"footer" in g ? g.footer : undefined}>
              {rows.length === 0 ? (
                <ListRow label="Nothing here" />
              ) : (
                rows.map((p) => (
                  <ListRow
                    key={p.id}
                    href={`/admin/proposals/${p.id}`}
                    label={<span className="font-mono text-[14px]">{p.applicationId.slice(0, 8)}</span>}
                    detail={[
                      utc(p.createdAt),
                      PROPOSAL_STATUS_LABELS[p.status],
                      p.decisionOutcome
                        ? `lender: ${DECISION_LABELS[p.decisionOutcome]}${p.decisionRevision && p.decisionRevision > 1 ? ` (rev ${p.decisionRevision})` : ""}`
                        : null,
                      p.reviewAction ? `${p.reviewAction}ed → ${DECISION_LABELS[p.finalOutcome!]}` : null,
                      p.lastError ? `error: ${p.lastError}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    accessory={<StatusBadge tone={QUEUE[p.queue].tone}>{QUEUE[p.queue].label}</StatusBadge>}
                  />
                ))
              )}
            </ListGroup>
          );
        })}
      </div>
    </AdminShell>
  );
}
