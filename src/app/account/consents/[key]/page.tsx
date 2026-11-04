import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink, ConsentText, ListGroup, ListRow } from "@/components/creatorco";
import { PageTitle } from "@/app/_components/page-title";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { RETENTION_HOLD_NOTE, getConsentCentre, purposeFor } from "@/modules/privacy";

import { requireConsentCentreAccess } from "@/app/_lib/member";

import { ConsentFrame, PurposeStatusBadge, dateTime } from "../_components";
import { GrantForm } from "../grant-form";

export async function generateMetadata({ params }: PageProps<"/account/consents/[key]">): Promise<Metadata> {
  const { key } = await params;
  return { title: purposeFor(key)?.label ?? "Consent" };
}

export default async function PurposePage({ params, searchParams }: PageProps<"/account/consents/[key]">) {
  const { key } = await params;
  const q = await searchParams;
  const policy = purposeFor(key);
  if (!policy) notFound();
  const { user, paused } = await requireConsentCentreAccess();
  const view = (await getConsentCentre(getDb(), user.userId)).find((p) => p.policy.key === key)!;
  const { status, current } = view;
  const canWithdraw = status === "on" || status === "needs_review";

  return (
    <ConsentFrame paused={paused}>
      <BackLink href="/account/consents" label="Consent centre" />
      <PageTitle title={policy.label} description={policy.summary} status={<PurposeStatusBadge status={status} />} />

      <div className="flex max-w-2xl flex-col gap-8">
        {q.granted ? <Alert tone="success">Consent recorded. Your receipt is below.</Alert> : null}
        {q.withdrawn ? <Alert tone="neutral">Consent withdrawn. Your receipt is below.</Alert> : null}
        {status === "needs_review" ? (
          <Alert tone="warning">
            This text has been updated since you agreed. Review the new version below to keep this purpose on.
          </Alert>
        ) : null}

        {current ? (
          <Card>
            <CardContent className="flex flex-col gap-5">
              <ConsentText id="consent-text" definition={current} />
              {status === "on" ? null : (
                <GrantForm
                  purposeKey={policy.key}
                  definitionId={current.id}
                  agreeLabel="I agree to this consent"
                  submitLabel={policy.core && paused ? "Resume membership" : "Give consent"}
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <Alert tone="neutral">This purpose isn&rsquo;t in use right now.</Alert>
        )}

        {view.deferredErasures.length ? (
          <Alert tone="info" title="Erasure on hold">
            Some data for this purpose is no longer used and will be erased once a financial relationship with a partner
            lender is closed.
          </Alert>
        ) : null}

        {canWithdraw ? (
          <ListGroup id="withdraw" label="Withdraw" footer={policy.erasure.length ? RETENTION_HOLD_NOTE : undefined}>
            <ListRow
              href={`/account/consents/${policy.key}/withdraw`}
              label={<span className="text-danger">{policy.core ? "Pause membership" : "Withdraw consent"}</span>}
              detail="See exactly what changes before you confirm."
            />
          </ListGroup>
        ) : null}

        <ListGroup
          id="receipts"
          label="Your receipts"
          footer="Every time you give or withdraw this consent is kept as a receipt."
        >
          {view.receipts.length === 0 ? (
            <ListRow label="No receipts yet" />
          ) : (
            view.receipts.map((r) => (
              <ListRow
                key={r.id}
                href={`/account/consents/receipts/${r.id}`}
                label={`Version ${r.version} · ${r.status === "granted" ? "Given" : "Withdrawn"}`}
                detail={
                  r.status === "granted" && r.grantedAt
                    ? `Given ${dateTime.format(r.grantedAt)}`
                    : r.withdrawnAt
                      ? `Given ${r.grantedAt ? dateTime.format(r.grantedAt) : "—"} · withdrawn ${dateTime.format(r.withdrawnAt)}`
                      : undefined
                }
              />
            ))
          )}
        </ListGroup>

        {paused && !policy.core ? (
          <Button asChild variant="secondary">
            <Link href="/account/consents/creator_profile">Resume membership</Link>
          </Button>
        ) : null}
      </div>
    </ConsentFrame>
  );
}
