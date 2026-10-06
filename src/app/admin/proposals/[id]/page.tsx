import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { recordAuditEvent } from "@/modules/audit";
import { formatInr } from "@/modules/financial-eligibility/presentation";
import { requireAdmin } from "@/modules/identity";
import { getProposalDetail } from "@/modules/lending";
import {
  DECISION_LABELS,
  LENDER_REASON_LABELS,
  OFFER_DECLINE_REASON_LABELS,
  PROPOSAL_STATUS_LABELS,
  kfsRows,
} from "@/modules/lending/presentation";
import { offerTermsSchema } from "@/providers/lender/offer";
import type { ProposalModelResult } from "@/providers/lender/proposal";

import { AdminShell } from "../../../_components/creator-shell";
import { retryProposalAction } from "../actions";
import { ReleaseForm, ReviewForm, WithdrawQueryForm } from "./forms";

export const metadata: Metadata = { title: "Credit proposal" };

const utc = (d: Date | string | null) => (d ? `${new Date(d).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");
const inr = (n: number | null | undefined) => (n == null ? "—" : formatInr(n));

function ModelRows({ label, r }: { label: string; r: ProposalModelResult | null }) {
  if (!r) return <ListRow label={label} value="Not included" />;
  return (
    <ListRow
      label={label}
      value={r.grade ? `Grade ${r.grade} · ${r.score}` : "Not graded"}
      detail={[
        r.outcome,
        `exposure ${inr(r.recommendedExposure)}`,
        r.recommendedTenorMonths ? `${r.recommendedTenorMonths} months` : null,
        `completeness ${Math.round(r.completeness * 100)}%`,
        r.reasonCodes.join(", "),
      ]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}

export default async function ProposalPage({ params }: PageProps<"/admin/proposals/[id]">) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const detail = await getProposalDetail(db, id);
  if (!detail) notFound();
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: admin.userId,
    eventType: "lending.proposal_viewed",
    entityType: "credit_proposal",
    entityId: id,
    metadata: {},
  });
  const { proposal: p, decision, decisions, queries, review } = detail;
  const lenderTerms = decision?.offerTerms ? offerTermsSchema.safeParse(decision.offerTerms) : null;
  const lenderKfs = lenderTerms?.success ? kfsRows(lenderTerms.data) : [];
  const payload = p.payload;

  return (
    <AdminShell role={admin.role}>
      <BackLink href="/admin/proposals" label="Proposals" />
      <PageHeader
        eyebrow={`Check ${p.applicationId.slice(0, 8)} · lender ${p.lender}${p.policyVersion ? ` · simulated policy v${p.policyVersion}` : " · partner lender"}`}
        title="Credit proposal"
        description="Exactly what was prepared for the partner lender (frozen when created), the lender's decision and the CreatorCo review."
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <ListGroup id="status" label="Status">
            <ListRow
              label={PROPOSAL_STATUS_LABELS[p.status]}
              detail={[
                `created ${utc(p.createdAt)}`,
                p.submittedAt ? `sent ${utc(p.submittedAt)}` : null,
                p.attempts ? `${p.attempts} attempt(s)` : null,
                p.lastError ? `last error: ${p.lastError}` : null,
                p.withdrawnReason ? `withdrawn: ${p.withdrawnReason.replace(/_/g, " ")}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              accessory={
                p.holdReason === "fraud_review" ? <StatusBadge tone="warning">Fraud review</StatusBadge> : null
              }
            />
            {p.releasedAt ? (
              <ListRow
                label="Released"
                detail={`${detail.releasedByEmail ?? "staff"} · ${utc(p.releasedAt)} · “${p.releaseReason}”`}
              />
            ) : null}
            <ListRow
              label="Underwriting run"
              value={
                <Link href={`/admin/underwriting/${p.underwritingRunId}`} className="text-gold">
                  Open
                </Link>
              }
            />
          </ListGroup>

          {p.status === "held" ? (
            <section aria-labelledby="release-heading" className="flex flex-col gap-3">
              <h2 id="release-heading" className="px-1 text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
                Release for sending
              </h2>
              <p className="px-1 text-[15px] text-ink-muted">
                The fraud layer flagged this check for review. Check the run&rsquo;s flags before releasing it.
              </p>
              <ReleaseForm proposalId={p.id} />
            </section>
          ) : null}
          {p.status === "failed" ? (
            <form action={retryProposalAction}>
              <input type="hidden" name="proposalId" value={p.id} />
              <Button type="submit" variant="secondary">
                Retry sending
              </Button>
            </form>
          ) : null}

          <ListGroup
            id="decision"
            label={
              decision && decision.revision > 1 ? `Lender decision · revision ${decision.revision}` : "Lender decision"
            }
            footer={
              decision
                ? decision.source === "partner_api"
                  ? `Posted by the partner through the partner API (key ${decision.apiKeyPrefix}…).`
                  : "From the lender adapter."
                : undefined
            }
          >
            {decision ? (
              <>
                <ListRow
                  label="Outcome"
                  accessory={
                    <StatusBadge tone={decision.outcome === "declined" ? "neutral" : "success"}>
                      {DECISION_LABELS[decision.outcome]}
                    </StatusBadge>
                  }
                />
                <ListRow label="Amount" value={inr(decision.approvedExposure)} />
                <ListRow
                  label="Tenor"
                  value={decision.approvedTenorMonths ? `${decision.approvedTenorMonths} months` : "—"}
                />
                <ListRow
                  label="Decision basis"
                  value={
                    decision.decisionBasis === "creator_enhanced"
                      ? "Creator-Enhanced"
                      : decision.decisionBasis === "traditional"
                        ? "Traditional"
                        : "Not stated"
                  }
                />
                <ListRow
                  label="Reasons"
                  detail={
                    decision.reasonCodes.length
                      ? decision.reasonCodes.map((c) => LENDER_REASON_LABELS[c] ?? c).join(" · ")
                      : "None"
                  }
                />
                <ListRow label="Decided" value={utc(decision.decidedAt)} />
              </>
            ) : (
              <ListRow label="No decision yet" />
            )}
          </ListGroup>

          {queries.length || decisions.length > 1 ? (
            <ListGroup
              id="history"
              label="Queries and revisions"
              footer="Queries go to the partner as written; it answers with a new revision."
            >
              {queries.map((q) => (
                <ListRow
                  key={q.id}
                  label={`Query on revision ${decisions.find((d) => d.id === q.decisionId)?.revision ?? "?"}`}
                  detail={`${q.raisedByEmail} · ${utc(q.createdAt)} · “${q.message}”${q.withdrawnBy ? ` · withdrawn ${utc(q.resolvedAt!)}: “${q.withdrawnReason}”` : q.resolvedAt ? ` · answered ${utc(q.resolvedAt)} by revision ${decisions.find((d) => d.id === q.resolvedDecisionId)?.revision ?? "?"}` : ""}`}
                  accessory={
                    <StatusBadge tone={q.resolvedAt ? "neutral" : "info"}>
                      {q.withdrawnBy ? "Withdrawn" : q.resolvedAt ? "Answered" : "Open"}
                    </StatusBadge>
                  }
                />
              ))}
              {decisions.slice(1).map((d) => (
                <ListRow
                  key={d.id}
                  label={`Revision ${d.revision}`}
                  detail={`${DECISION_LABELS[d.outcome]} · ${inr(d.approvedExposure)}${d.approvedTenorMonths ? ` · ${d.approvedTenorMonths} months` : ""} · ${utc(d.decidedAt)}`}
                />
              ))}
            </ListGroup>
          ) : null}

          {decision?.offerTerms && !review ? (
            <ListGroup
              id="lender-offer"
              label="The lender's offer (KFS)"
              footer={[
                `Valid until ${utc(decision.offerExpiresAt)}.`,
                detail.simulated
                  ? "Illustrative terms from the simulated lender. An override re-prices them at the same rate and fee for the reduced amount, and the simulated offer's validity restarts when you review."
                  : "The partner lender's terms as provided. Confirming shows them to the creator; raise a query if they look wrong.",
                decision.offerExpiresAt && decision.offerExpiresAt <= new Date()
                  ? "This offer has expired — it can't be confirmed; raise a query for a fresh decision."
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {lenderKfs.map((r) => (
                <ListRow key={r.label} label={r.label} value={r.value} />
              ))}
            </ListGroup>
          ) : null}
          {review ? (
            <ListGroup id="review" label="CreatorCo review">
              <ListRow
                label={review.action === "override" ? "Overridden" : "Confirmed"}
                detail={`${review.reviewerEmail} · ${utc(review.createdAt)}${review.reason ? ` · “${review.reason}”` : ""}`}
              />
              <ListRow label="Final outcome" value={DECISION_LABELS[review.finalOutcome]} />
              <ListRow label="Final amount" value={inr(review.finalExposure)} />
              <ListRow
                label="Final tenor"
                value={review.finalTenorMonths ? `${review.finalTenorMonths} months` : "—"}
              />
            </ListGroup>
          ) : detail.openQuery ? (
            <section aria-label="Waiting for the partner" className="flex flex-col gap-4">
              <ListGroup id="awaiting-partner" label="CreatorCo review">
                <ListRow
                  label="Waiting for the partner's answer"
                  detail="The creator sees “with a partner lender” until the partner answers and the new revision is confirmed."
                />
              </ListGroup>
              <WithdrawQueryForm proposalId={p.id} />
            </section>
          ) : decision && detail.reviewActions.length ? (
            <section aria-labelledby="review-heading" className="flex flex-col gap-3">
              <h2 id="review-heading" className="px-1 text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
                Review the decision
              </h2>
              <ReviewForm
                proposalId={p.id}
                decision={{
                  id: decision.id,
                  outcome: decision.outcome,
                  exposure: decision.approvedExposure,
                  tenorMonths: decision.approvedTenorMonths,
                }}
                actions={detail.reviewActions}
              />
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-8">
          {detail.offer ? (
            <ListGroup
              id="offer"
              label="Offer shown to the creator"
              action={
                <StatusBadge
                  tone={
                    detail.offerResponse?.response === "accepted"
                      ? "success"
                      : detail.offerResponse
                        ? "neutral"
                        : detail.offerExpiresAt && detail.offerExpiresAt <= new Date()
                          ? "neutral"
                          : "info"
                  }
                >
                  {detail.offerResponse?.response === "accepted"
                    ? "Accepted"
                    : detail.offerResponse
                      ? "Declined"
                      : detail.offerExpiresAt && detail.offerExpiresAt <= new Date()
                        ? "Expired"
                        : "Awaiting the creator"}
                </StatusBadge>
              }
              footer={[
                `Valid until ${utc(detail.offerExpiresAt)}.`,
                detail.offerResponse
                  ? `Answered ${utc(detail.offerResponse.respondedAt)}${
                      detail.offerResponse.declineReason
                        ? ` · ${OFFER_DECLINE_REASON_LABELS[detail.offerResponse.declineReason]}`
                        : ""
                    } · terms hash ${detail.offerResponse.termsHash.slice(0, 12)}…`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {kfsRows(detail.offer).map((r) => (
                <ListRow key={r.label} label={r.label} value={r.value} />
              ))}
            </ListGroup>
          ) : null}
          <ListGroup
            id="payload"
            label="What the lender receives"
            footer={`Data groups: ${payload.dataGroups.join(", ")}. Consent receipt ${p.consentReceiptId.slice(0, 8)}. Payload hash ${p.payloadHash.slice(0, 12)}…`}
          >
            <ListRow
              label="Requested"
              value={inr(payload.request.requestedAmount)}
              detail={payload.request.purposes.join(", ")}
            />
            <ModelRows label="Traditional" r={payload.models?.traditional ?? null} />
            <ModelRows label="Creator-Enhanced" r={payload.models?.creatorEnhanced ?? null} />
            {payload.bankCoverage ? (
              <ListRow
                label="Bank coverage"
                value={payload.bankCoverage.status}
                detail={`${payload.bankCoverage.accountsShared} shared · ${payload.bankCoverage.accountsNotReceived} not received`}
              />
            ) : null}
            {payload.fraud ? <ListRow label="Fraud summary" value={payload.fraud.outcome} /> : null}
            <ListRow
              label="Versions"
              detail={`${payload.versions.underwriting} · ${payload.versions.financialCapacity} · ${payload.versions.fraudRules}`}
            />
          </ListGroup>
          {payload.financialCapacity ? (
            <ListGroup id="capacity" label="Financial Capacity (as sent)">
              {payload.financialCapacity.map((f) => (
                <ListRow
                  key={f.key}
                  label={<span className="font-mono text-[13px]">{f.key}</span>}
                  value={f.value === null ? "—" : String(f.value)}
                />
              ))}
            </ListGroup>
          ) : null}
        </div>
      </div>
    </AdminShell>
  );
}
