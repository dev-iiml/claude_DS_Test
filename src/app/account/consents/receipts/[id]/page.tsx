import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink, ConsentText, ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import { PageTitle } from "@/app/_components/page-title";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { WITHDRAWAL_REASON_LABELS, getReceipt, purposeFor } from "@/modules/privacy";

import { requireConsentCentreAccess } from "@/app/_lib/member";

import { ConsentFrame, dateTime } from "../../_components";

export const metadata: Metadata = { title: "Consent receipt" };

const SOURCE_LABEL: Record<string, string> = {
  onboarding: "During onboarding",
  settings: "Consent centre",
  api: "CreatorCo app",
  system: "CreatorCo",
};

export default async function ReceiptPage({ params }: PageProps<"/account/consents/receipts/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { user, paused } = await requireConsentCentreAccess();
  const receipt = await getReceipt(getDb(), { userId: user.userId, receiptId: id });
  if (!receipt) notFound();
  const policy = purposeFor(receipt.key);

  return (
    <ConsentFrame paused={paused}>
      <BackLink href={`/account/consents/${receipt.key}`} label={policy?.label ?? "Consent"} />
      <PageTitle
        title="Consent receipt"
        status={
          <StatusBadge tone={receipt.status === "granted" ? "success" : "neutral"}>
            {receipt.status === "granted" ? "Given" : "Withdrawn"}
          </StatusBadge>
        }
      />
      <div className="flex max-w-2xl flex-col gap-8">
        <ListGroup id="receipt" label="Receipt">
          <ListRow
            label="Reference"
            value={<span className="font-mono text-[13px]">{receipt.id.slice(0, 8).toUpperCase()}</span>}
          />
          <ListRow label="Purpose" value={policy?.label ?? receipt.key} />
          <ListRow label="Version" value={receipt.version} />
          <ListRow
            label="Given"
            value={
              <span className="whitespace-nowrap">{receipt.grantedAt ? dateTime.format(receipt.grantedAt) : "—"}</span>
            }
          />
          <ListRow label="Where" value={SOURCE_LABEL[receipt.source] ?? "CreatorCo"} />
          {receipt.withdrawnAt ? (
            <ListRow
              label="Withdrawn"
              value={<span className="whitespace-nowrap">{dateTime.format(receipt.withdrawnAt)}</span>}
            />
          ) : null}
          {receipt.withdrawal?.reason ? (
            <ListRow label="Reason" value={WITHDRAWAL_REASON_LABELS[receipt.withdrawal.reason]} />
          ) : null}
        </ListGroup>

        <Card>
          <CardContent>
            <ConsentText id="receipt-text" definition={receipt} />
          </CardContent>
        </Card>

        <ListGroup
          id="fingerprint"
          label="Text fingerprint"
          footer="A SHA-256 of the exact wording you agreed to. It changes if a single character of the text changes. Quote the full receipt ID if you contact us about this consent."
        >
          <ListRow
            label="Full receipt ID"
            detail={<span className="font-mono text-[13px] break-all">{receipt.id}</span>}
          />
          <ListRow label={<span className="font-mono text-[13px] break-all">{receipt.fingerprint}</span>} />
        </ListGroup>
      </div>
    </ConsentFrame>
  );
}
