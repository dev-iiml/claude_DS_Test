import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BackLink, CreatorStatusBadge, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { getRequestForStaff } from "@/modules/access";
import { ACCESS_DECLINE_REASON_LABELS, ACCESS_REQUEST_STATUS_LABELS } from "@/modules/access/presentation";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { formatPoints } from "@/modules/rewards/rules";

import { PartnershipsShell } from "../../../_components/creator-shell";
import { REQUEST_TONE, istDateTime } from "../../_lib/present";
import { DecideRequestForm } from "../../forms";

export const metadata: Metadata = { title: "Access request" };

const NOTICES: Record<string, string> = {
  approved: "Approved. The creator sees it on their Access page.",
  declined: "Declined. The creator's points were returned.",
};

const people = new Intl.NumberFormat("en-IN");

export default async function RequestPage({ params, searchParams }: PageProps<"/partnerships/requests/[id]">) {
  const staff = await requirePartnershipsAdmin();
  const { id } = await params;
  const q = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await getRequestForStaff(getDb(), { requestId: id, staffUserId: staff.userId });
  if (!r) notFound();
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;

  return (
    <PartnershipsShell role={staff.role}>
      <BackLink href="/partnerships" label="Requests" />
      <PageHeader
        eyebrow={`${r.opportunity.brandName} (sample)`}
        title={`${r.creator.displayName} · ${r.opportunity.title}`}
        action={<StatusBadge tone={REQUEST_TONE[r.status]}>{ACCESS_REQUEST_STATUS_LABELS[r.status]}</StatusBadge>}
      />
      {notice ? (
        <Alert tone="success" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-8">
          <ListGroup
            id="creator"
            label="Creator"
            footer="The creator-professional summary covered by the brand opportunities consent. No financial data."
          >
            <ListRow label="Display name" value={r.creator.displayName} />
            <ListRow label="Handle" value={r.creator.handle ? `@${r.creator.handle}` : "—"} />
            <ListRow label="Category" value={r.creator.category ?? "—"} />
            <ListRow label="City" value={r.creator.city ?? "—"} />
            <ListRow
              label="Creator Status"
              detail={r.creator.currentTier !== r.tierAtRequest ? "Changed since the request" : undefined}
              accessory={<CreatorStatusBadge tier={r.creator.currentTier} />}
            />
            <ListRow
              label="Connected platforms"
              value={r.creator.platforms.length ? r.creator.platforms.join(", ") : "None"}
            />
            <ListRow
              label="Total audience"
              value={r.creator.totalAudience !== null ? people.format(r.creator.totalAudience) : "Not measured"}
            />
          </ListGroup>
          <ListGroup id="note" label="Note from the creator">
            <ListRow label={r.note ?? "No note"} />
          </ListGroup>
        </div>

        <div className="flex flex-col gap-8">
          <ListGroup id="request" label="Request">
            <ListRow label="Opportunity" value={r.opportunity.title} />
            <ListRow label="Places" value={String(r.opportunity.seats)} />
            <ListRow label="Points" value={formatPoints(r.pointsHeld)} />
            <ListRow label="Requested" value={istDateTime.format(r.requestedAt)} />
            {r.decidedAt ? <ListRow label="Decided" value={istDateTime.format(r.decidedAt)} /> : null}
            {r.declineReason ? <ListRow label="Reason" value={ACCESS_DECLINE_REASON_LABELS[r.declineReason]} /> : null}
          </ListGroup>

          {r.status === "requested" ? (
            r.creator.paused ? (
              <>
                <Alert tone="warning">This creator&apos;s membership is paused. You can only decline.</Alert>
                <DecideRequestForm requestId={r.id} canApprove={false} />
              </>
            ) : (
              <DecideRequestForm requestId={r.id} />
            )
          ) : null}
        </div>
      </div>
    </PartnershipsShell>
  );
}
