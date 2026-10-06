import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BackLink, ListGroup, ListRow, PageHeader } from "@/components/creatorco";
import { getDb } from "@/db";
import { RETENTION_HOLD_NOTE, WITHDRAWAL_REASON_LABELS, getConsentCentre, purposeFor } from "@/modules/privacy";

import { requireConsentCentreAccess } from "@/app/_lib/member";

import { ConsentFrame } from "../../_components";
import { WithdrawForm } from "./withdraw-form";

export const metadata: Metadata = { title: "Withdraw consent" };

export default async function WithdrawPage({ params }: PageProps<"/account/consents/[key]/withdraw">) {
  const { key } = await params;
  const policy = purposeFor(key);
  if (!policy) notFound();
  const { user, paused } = await requireConsentCentreAccess();
  const view = (await getConsentCentre(getDb(), user.userId)).find((p) => p.policy.key === key)!;
  if (view.status !== "on" && view.status !== "needs_review") redirect(`/account/consents/${key}`);

  return (
    <ConsentFrame paused={paused}>
      <BackLink href={`/account/consents/${key}`} label={policy.label} />
      <PageHeader
        title={policy.core ? "Pause membership?" : "Withdraw consent?"}
        description={`${policy.label}. Here is exactly what happens.`}
      />
      <div className="flex max-w-2xl flex-col gap-8">
        <ListGroup id="effects" label="What changes" footer={policy.erasure.length ? RETENTION_HOLD_NOTE : undefined}>
          {policy.onWithdraw.map((line) => (
            <ListRow key={line} label={<span className="text-[15px]">{line}</span>} />
          ))}
        </ListGroup>
        <WithdrawForm
          purposeKey={policy.key}
          reasons={Object.entries(WITHDRAWAL_REASON_LABELS).map(([value, label]) => ({ value, label }))}
          submitLabel={policy.core ? "Pause membership" : "Withdraw consent"}
        />
        <p className="px-1 text-[13px] leading-snug text-ink-subtle">
          You can give this consent again at any time. Your receipts are kept either way.
        </p>
      </div>
    </ConsentFrame>
  );
}
