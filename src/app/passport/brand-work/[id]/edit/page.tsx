import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { BackLink, PageHeader } from "@/components/creatorco";
import { getDb } from "@/db";
import { getRecordForCreator } from "@/modules/brand-work";

import { requireMember } from "../../../../_lib/member";
import { CreatorShell } from "../../../../_components/creator-shell";
import { istToday } from "../../_lib";
import { RecordForm } from "../../record-form";

export const metadata: Metadata = { title: "Edit brand work" };

export default async function EditBrandWorkPage({ params }: PageProps<"/passport/brand-work/[id]/edit">) {
  const { user } = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await getRecordForCreator(getDb(), user.userId, id);
  if (!r) notFound();
  if (r.verificationStatus !== "draft" && r.verificationStatus !== "needs_info") redirect(`/passport/brand-work/${id}`);
  return (
    <CreatorShell>
      <BackLink href={`/passport/brand-work/${id}`} label="Brand work" />
      <PageHeader title="Edit brand work" />
      <div className="max-w-2xl">
        <RecordForm
          recordId={id}
          definition={null}
          today={istToday()}
          saved={{
            endBrandName: r.endBrandName,
            billedPartyType: r.billedPartyType,
            billedPartyName: r.billedPartyName,
            industryCode: r.industryCode,
            platforms: r.platforms,
            deliverables: r.deliverables,
            visibility: r.visibility,
            description: r.description,
            deliverablesSummary: r.deliverablesSummary,
            workDate: r.workDate,
            invoiceDate: r.invoiceDate,
            invoiceAmountRupees: r.invoiceAmountPaise !== null ? String(r.invoiceAmountPaise / 100) : null,
          }}
        />
      </div>
    </CreatorShell>
  );
}
