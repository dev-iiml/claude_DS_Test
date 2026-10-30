import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BackLink, CreatorStatusBadge, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { getOpportunityForStaff, listBrands, listRequestsForStaff } from "@/modules/access";
import { ACCESS_REQUEST_STATUS_LABELS, OPPORTUNITY_STATUS_LABELS } from "@/modules/access/presentation";
import { requirePartnershipsAdmin } from "@/modules/identity";

import { PartnershipsShell } from "../../../_components/creator-shell";
import { OPPORTUNITY_TONE, REQUEST_TONE, istDateTime, toIstLocal } from "../../_lib/present";
import { CloseOpportunityForm, OpportunityForm } from "../../forms";

export const metadata: Metadata = { title: "Opportunity" };

const NOTICES: Record<string, string> = {
  created: "Opportunity created.",
  saved: "Changes saved.",
  closed: "Closed to new requests. Pending requests expired and their points were returned.",
};

export default async function StaffOpportunityPage({
  params,
  searchParams,
}: PageProps<"/partnerships/opportunities/[id]">) {
  const staff = await requirePartnershipsAdmin();
  const { id } = await params;
  const q = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const o = await getOpportunityForStaff(db, id);
  if (!o) notFound();
  const [brands, requests] = await Promise.all([listBrands(db), listRequestsForStaff(db, { opportunityId: id })]);
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;

  return (
    <PartnershipsShell role={staff.role}>
      <BackLink href="/partnerships/opportunities" label="Opportunities" />
      <PageHeader
        eyebrow={`${o.brandName} (sample)`}
        title={o.title}
        description={o.summary}
        action={<StatusBadge tone={OPPORTUNITY_TONE[o.status]}>{OPPORTUNITY_STATUS_LABELS[o.status]}</StatusBadge>}
      />
      {notice ? (
        <Alert tone="success" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      <div className="flex max-w-3xl flex-col gap-10">
        <ListGroup id="requests" label="Requests">
          {requests.length ? (
            requests.map((r) => (
              <ListRow
                key={r.id}
                href={`/partnerships/requests/${r.id}`}
                label={r.displayName}
                detail={istDateTime.format(r.requestedAt)}
                leading={<CreatorStatusBadge tier={r.tierAtRequest} />}
                accessory={
                  <StatusBadge tone={REQUEST_TONE[r.status]}>{ACCESS_REQUEST_STATUS_LABELS[r.status]}</StatusBadge>
                }
              />
            ))
          ) : (
            <ListRow label="No requests yet" />
          )}
        </ListGroup>

        {o.status === "closed" ? (
          <Alert tone="info">This opportunity is closed and can no longer be edited.</Alert>
        ) : (
          <>
            <section aria-labelledby="edit-heading">
              <h2 id="edit-heading" className="mb-4 text-title-3 font-semibold tracking-tight">
                Edit
              </h2>
              <OpportunityForm
                brands={brands.map((b) => ({ id: b.id, name: b.name }))}
                initial={{
                  id: o.id,
                  brandId: o.brandId,
                  title: o.title,
                  kind: o.kind,
                  category: o.category,
                  summary: o.summary,
                  details: o.details,
                  minTier: o.minTier,
                  pointsCost: String(o.pointsCost),
                  seats: String(o.seats),
                  opensAt: toIstLocal(o.opensAt),
                  closesAt: toIstLocal(o.closesAt),
                  status: o.status,
                }}
              />
            </section>
            <section aria-labelledby="close-heading" className="flex flex-col gap-3">
              <h2 id="close-heading" className="text-title-3 font-semibold tracking-tight">
                Close opportunity
              </h2>
              <p className="text-subhead text-ink-muted">
                Stops new requests. Pending requests expire and their points go back to the creators; approved ones
                stay.
              </p>
              <CloseOpportunityForm id={o.id} />
            </section>
          </>
        )}
      </div>
    </PartnershipsShell>
  );
}
