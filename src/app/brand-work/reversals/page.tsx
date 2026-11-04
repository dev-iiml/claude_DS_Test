import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { listOpenReversals, listReasons } from "@/modules/brand-work";
import { requireBrandWorkReviewer } from "@/modules/identity";

import { BrandWorkShell } from "../../_components/creator-shell";
import { DecideReversalForm } from "../forms";

export const metadata: Metadata = { title: "Reversals" };

const when = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export default async function ReversalsPage({ searchParams }: PageProps<"/brand-work/reversals">) {
  const staff = await requireBrandWorkReviewer();
  const db = getDb();
  const [open, reasons] = await Promise.all([listOpenReversals(db), listReasons(db)]);
  const reasonLabel = new Map(reasons.map((r) => [r.code, r.label]));
  const q = await searchParams;
  return (
    <BrandWorkShell role={staff.role}>
      <PageHeader
        eyebrow="Internal · four eyes"
        title="Reversals"
        description="A reviewer proposes reversing a verification; a different reviewer approves or declines. Approval un-verifies the record and reverses milestone points it no longer supports, in one step."
      />
      {q.notice === "approved" || q.notice === "declined" ? (
        <Alert tone="success" className="mb-6">
          {q.notice === "approved" ? "Reversal approved." : "Reversal declined."}
        </Alert>
      ) : null}
      <ListGroup id="open" label="Waiting for a decision">
        {open.length ? (
          open.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/brand-work/records/${r.recordId}`} className="text-body font-medium text-gold">
                  {r.creatorName ?? "Creator"} · {r.endBrandName}
                </Link>
                <span className="text-footnote text-ink-subtle">
                  {reasonLabel.get(r.reasonCode) ?? r.reasonCode} · {when.format(r.proposedAt)}
                </span>
              </div>
              {r.proposedBy === staff.userId ? (
                <p className="text-footnote text-ink-muted">You proposed this — another reviewer has to decide.</p>
              ) : (
                <DecideReversalForm reversalId={r.id} recordId={r.recordId} />
              )}
            </li>
          ))
        ) : (
          <ListRow label="Nothing waiting" />
        )}
      </ListGroup>
    </BrandWorkShell>
  );
}
