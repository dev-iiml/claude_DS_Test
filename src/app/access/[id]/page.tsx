import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { getOpportunityForCreator } from "@/modules/access";
import {
  ACCESS_DECLINE_REASON_LABELS,
  OPPORTUNITY_KIND_LABELS,
  tierRequirementLabel,
} from "@/modules/access/presentation";
import type { AccessDeclineReason } from "@/modules/access/domain";
import { CONSENT_KEYS, getActiveDefinition, hasValidConsent } from "@/modules/consent";
import { CREATOR_STATUS_LABELS } from "@/modules/creator-status/status";
import { pointsBalance } from "@/modules/rewards/ledger-service";
import { formatPoints } from "@/modules/rewards/rules";

import { recordAfterResponse } from "../../_lib/analytics";
import { requireMember } from "../../_lib/member";
import { CreatorShell } from "../../_components/creator-shell";
import { availabilityBadge, costLabel, fullDate } from "../_lib/present";

import { CancelRequestForm, RequestAccessForm } from "./forms";

export const metadata: Metadata = { title: "Opportunity" };

const NOTICES: Record<string, string> = {
  requested: "Request sent. Your points are held until the partnerships team decides.",
  cancelled: "Request cancelled. Your points are back in your balance.",
};

export default async function OpportunityPage({ params, searchParams }: PageProps<"/access/[id]">) {
  const { user, passport } = await requireMember();
  const { id } = await params;
  const q = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const o = await getOpportunityForCreator(db, {
    userId: user.userId,
    creatorId: passport.creatorId,
    opportunityId: id,
  });
  if (!o) notFound();
  // Optional screen-view measurement: recorded only with the Product analytics consent.
  await recordAfterResponse({ event: "access_opportunity_viewed", userId: user.userId, props: { kind: o.kind } });
  const [balance, consented] = await Promise.all([
    pointsBalance(db, passport.creatorId),
    hasValidConsent(db, user.userId, CONSENT_KEYS.brandOpportunities),
  ]);
  const definition =
    o.availability === "open" && !consented ? await getActiveDefinition(db, CONSENT_KEYS.brandOpportunities) : null;
  const badge = availabilityBadge(o);
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;

  return (
    <CreatorShell>
      <BackLink href="/access" label="Access" />
      <PageHeader
        eyebrow={`${OPPORTUNITY_KIND_LABELS[o.kind]} · ${o.brand.name}${o.brand.isSample ? " (sample)" : ""}`}
        title={o.title}
        description={o.summary}
        action={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
      />
      {notice ? (
        <Alert tone="success" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      <div className="flex max-w-2xl flex-col gap-8">
        <p className="text-body leading-relaxed whitespace-pre-line text-ink-muted">{o.details}</p>

        <ListGroup id="details" label="Details">
          <ListRow label="Category" value={o.category} />
          <ListRow label="Who can request" value={tierRequirementLabel(o.minTier)} />
          <ListRow label="Creator Points" value={costLabel(o.pointsCost)} />
          <ListRow label="Places left" value={String(o.seatsLeft)} />
          <ListRow label="Requests close" value={fullDate.format(o.closesAt)} />
        </ListGroup>

        {o.request?.status === "requested" ? (
          <ListGroup
            id="your-request"
            label="Your request"
            footer="The partnerships team reviews requests. If it isn't approved, or the opportunity closes first, your points come back."
          >
            <ListRow label="Status" accessory={<StatusBadge tone="info">Requested</StatusBadge>} />
            <ListRow label="Points held" value={formatPoints(o.request.pointsHeld)} />
            <ListRow label="Cancel" detail={<CancelRequestForm requestId={o.request.id} opportunityId={o.id} />} />
          </ListGroup>
        ) : o.request?.status === "approved" ? (
          <ListGroup id="your-request" label="Your request">
            <ListRow label="Status" accessory={<StatusBadge tone="success">Approved</StatusBadge>} />
            <ListRow
              label="What happens next"
              detail="This is a preview, so nothing happens next: with a real brand, its team would contact you through CreatorCo."
            />
            {o.request.pointsHeld > 0 ? (
              <ListRow label="Points spent" value={formatPoints(o.request.pointsHeld)} />
            ) : null}
          </ListGroup>
        ) : (
          <>
            {o.request && (o.request.status === "declined" || o.request.status === "expired") ? (
              <Alert tone="info">
                {o.request.status === "declined"
                  ? `Your last request wasn't selected${
                      o.request.declineReason
                        ? ` — ${ACCESS_DECLINE_REASON_LABELS[o.request.declineReason as AccessDeclineReason].toLowerCase()}`
                        : ""
                    }. Its points were returned.`
                  : "Your last request expired when requests closed. Its points were returned."}
              </Alert>
            ) : null}
            {o.availability === "open" ? (
              <section aria-labelledby="request-heading" className="flex flex-col gap-4">
                <h2 id="request-heading" className="text-title-3 font-semibold tracking-tight">
                  Request access
                </h2>
                <RequestAccessForm
                  opportunityId={o.id}
                  costLabel={costLabel(o.pointsCost)}
                  definition={
                    definition
                      ? {
                          id: definition.id,
                          title: definition.title,
                          purpose: definition.purpose,
                          body: definition.body,
                          version: definition.version,
                        }
                      : null
                  }
                />
              </section>
            ) : o.availability === "tier_locked" ? (
              <Alert tone="info">
                This opportunity is for {CREATOR_STATUS_LABELS[o.minTier]} members. You&apos;re{" "}
                {CREATOR_STATUS_LABELS[passport.tier]} — see how Creator Status works on your Passport.
              </Alert>
            ) : o.availability === "insufficient_points" ? (
              <Alert tone="info">
                This needs {formatPoints(o.pointsCost)}; you have {formatPoints(balance)}.
              </Alert>
            ) : o.availability === "full" ? (
              <Alert tone="info">Every place has been taken.</Alert>
            ) : o.availability === "not_open_yet" ? (
              <Alert tone="info">Requests open on {fullDate.format(o.opensAt)}.</Alert>
            ) : (
              <Alert tone="info">Requests for this opportunity have closed.</Alert>
            )}
          </>
        )}

        <p className="text-footnote text-ink-subtle">
          Preview: {o.brand.name} is a sample brand. Nothing is sent to a brand and nothing is fulfilled. Creator Points
          are simulated membership points with no cash value.
        </p>
      </div>
    </CreatorShell>
  );
}
