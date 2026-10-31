import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getRecordForReviewer, listIndustries, listReasons, searchDirectory } from "@/modules/brand-work";
import {
  DOCUMENT_KIND_LABELS,
  BILLED_PARTY_LABELS,
  CONFIRMATION_METHOD_COPY,
  DELIVERABLE_LABELS,
  INDUSTRY_LABELS,
  PAYMENT_STATUS_COPY,
  PLATFORM_LABELS,
  VERIFICATION_STATUS_COPY,
  formatMonth,
  formatPaise,
} from "@/modules/brand-work/presentation";
import { BRAND_WORK_FLAG_LABELS, type BrandWorkFlag } from "@/modules/brand-work/rules";
import { requireBrandWorkReviewer } from "@/modules/identity";
import { EARN_RULES, type EarnRule } from "@/modules/rewards/rules";

import { BrandWorkShell } from "../../../_components/creator-shell";
import { startReviewAction, viewDocumentAction } from "../../actions";
import {
  NegativeDecisionForm,
  PaymentConfirmationForm,
  ProposeReversalForm,
  ResolveBrandForm,
  VerifyForm,
} from "../../forms";

export const metadata: Metadata = { title: "Brand work record" };

const NOTICES: Record<string, string> = {
  brand_resolved: "Brand and industry confirmed.",
  started: "The record is yours for the next 30 minutes.",
  verified: "Verified. Milestone points were granted if reached.",
  awaiting_second_review: "Recorded. This record is flagged, so a second reviewer has to verify it.",
  request_info: "Sent back to the creator with a neutral message.",
  reject: "Marked not verified.",
  payment_confirmed: "Payment confirmed.",
  reversal_proposed: "Reversal proposed. Another reviewer has to approve it.",
};

const when = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export default async function ReviewRecordPage({ params, searchParams }: PageProps<"/brand-work/records/[id]">) {
  const staff = await requireBrandWorkReviewer();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const detail = await getRecordForReviewer(db, { reviewerId: staff.userId, recordId: id });
  if (!detail) notFound();
  const [reasons, industries, brands] = await Promise.all([
    listReasons(db),
    listIndustries(db),
    searchDirectory(db, undefined),
  ]);
  const q = await searchParams;
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;
  const r = detail.record;
  const status = VERIFICATION_STATUS_COPY[r.verificationStatus];
  const reviewing = r.verificationStatus === "in_review" && !detail.isOwn;
  const secondReview = Boolean(r.firstReviewerId);
  const mineFirst = r.firstReviewerId === staff.userId;
  const reasonOptions = reasons.map((x) => ({ value: x.code, label: x.label }));
  const industryOptions = industries.map((i) => ({ value: i.code, label: i.label }));
  const openReversal = detail.reversals.find((x) => x.status === "proposed");
  // Viewing never locks a record; "Start review" does (30 minutes). Decisions still respect another's lock.
  const lockMessage = detail.lock.byOther ? "Another reviewer has this record open." : null;
  const canStart = reviewing && !mineFirst && !detail.lock.live;

  return (
    <BrandWorkShell role={staff.role}>
      <BackLink href="/brand-work" label="Review queue" />
      <PageHeader
        eyebrow={`${detail.creator.name}${detail.creator.handle ? ` · @${detail.creator.handle}` : ""}`}
        title={r.endBrandName}
        description={r.description}
        action={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {detail.isOwn ? (
            <Alert tone="warning">This is your own creator account. Someone else has to review it.</Alert>
          ) : null}
          {lockMessage && !detail.isOwn ? <Alert tone="warning">{lockMessage}</Alert> : null}
          {canStart ? (
            <form action={startReviewAction} className="flex items-center gap-3">
              <input type="hidden" name="recordId" value={r.id} />
              <Button type="submit" variant="secondary" size="sm">
                Start review
              </Button>
              <span className="text-footnote text-ink-muted">Holds the record for you for 30 minutes.</span>
            </form>
          ) : null}

          {r.flags.length ? (
            <ListGroup
              id="flags"
              label="Flags"
              footer={`Rules ${r.rulesVersion ?? "—"}. Flags route to a second reviewer; they never reject on their own.`}
            >
              {(r.flags as BrandWorkFlag[]).map((f) => (
                <ListRow key={f} label={BRAND_WORK_FLAG_LABELS[f] ?? f} />
              ))}
            </ListGroup>
          ) : null}

          <ListGroup id="record" label="Record">
            <ListRow label="Brand (as entered)" value={r.endBrandName} />
            <ListRow
              label="Directory brand"
              value={
                detail.brand
                  ? `${detail.brand.name} · ${INDUSTRY_LABELS[detail.brand.industry ?? ""] ?? ""}`
                  : "To confirm"
              }
            />
            <ListRow
              label="Billed to"
              value={
                r.billedPartyType === "brand"
                  ? BILLED_PARTY_LABELS.brand
                  : `${r.billedPartyName} (${r.billedPartyType})`
              }
            />
            <ListRow
              label="Industry"
              value={
                r.industryCode
                  ? `${INDUSTRY_LABELS[r.industryCode] ?? r.industryCode}${r.industryConfirmed ? "" : " (suggested)"}`
                  : "—"
              }
            />
            <ListRow label="Platforms" value={r.platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")} />
            <ListRow
              label="Deliverables"
              value={r.deliverables
                .map((d) => DELIVERABLE_LABELS[d as keyof typeof DELIVERABLE_LABELS] ?? d)
                .join(", ")}
              detail={r.deliverablesSummary ?? undefined}
            />
            <ListRow label="Work month" value={formatMonth(r.workDate)} />
            <ListRow label="Invoice date" value={r.invoiceDate ?? "—"} />
            <ListRow label="Invoice amount" value={formatPaise(r.invoiceAmountPaise)} />
            <ListRow label="Visibility" value={r.visibility === "private" ? "Private (NDA)" : "Shown on Passport"} />
            <ListRow
              label="Payment"
              value={PAYMENT_STATUS_COPY[r.paymentStatus]}
              detail={
                r.paymentConfirmationMethod
                  ? `${CONFIRMATION_METHOD_COPY[r.paymentConfirmationMethod].label}${r.paymentConfirmedMonth ? ` · ${formatMonth(r.paymentConfirmedMonth)}` : ""}`
                  : r.requestedConfirmation
                    ? `Creator chose: ${CONFIRMATION_METHOD_COPY[r.requestedConfirmation].label}`
                    : undefined
              }
            />
          </ListGroup>

          <ListGroup id="documents" label="Documents" footer="Each view issues a 2-minute link and is logged.">
            {detail.documents.length ? (
              detail.documents.map((d) => (
                <ListRow
                  key={d.id}
                  label={DOCUMENT_KIND_LABELS[d.kind]}
                  detail={`${d.mimeType} · ${Math.max(1, Math.round(d.sizeBytes / 1024))} KB · ${when.format(d.uploadedAt)} · ${d.scanStatus}`}
                  accessory={
                    d.scanStatus === "clean" && !detail.isOwn ? (
                      <form action={viewDocumentAction}>
                        <input type="hidden" name="documentId" value={d.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          View
                        </Button>
                      </form>
                    ) : undefined
                  }
                />
              ))
            ) : (
              <ListRow label="No documents" />
            )}
          </ListGroup>

          <ListGroup id="history" label="History" footer="Codes, ids and points only — never document contents.">
            {detail.reviews.map((h) => (
              <ListRow
                key={h.id}
                label={h.action.replace(/_/g, " ")}
                detail={[
                  h.reviewerEmail ?? "staff",
                  when.format(h.createdAt),
                  h.reasonCode,
                  h.note ? `“${h.note}”` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={`rev ${h.revision}`}
              />
            ))}
            {detail.points.map((p, i) => (
              <ListRow
                key={`p-${i}`}
                label={`${p.type === "reverse" ? "Points reversed" : "Points granted"}: ${p.rule && p.rule in EARN_RULES ? EARN_RULES[p.rule as EarnRule].label : p.rule}`}
                detail={when.format(p.at)}
                value={String(p.amount)}
              />
            ))}
            {!detail.reviews.length && !detail.points.length ? <ListRow label="No actions yet" /> : null}
          </ListGroup>
        </div>

        <div className="flex flex-col gap-8">
          {reviewing ? (
            <>
              <section aria-labelledby="brand-heading" className="flex flex-col gap-3">
                <h2 id="brand-heading" className="text-title-3 font-semibold tracking-tight">
                  1. Confirm the brand
                </h2>
                <ResolveBrandForm
                  recordId={r.id}
                  brands={brands.map((b) => ({ value: b.id, label: b.name }))}
                  industries={industryOptions}
                  suggestedIndustry={r.industryCode}
                  currentBrandId={r.brandDirectoryId}
                />
              </section>
              <section aria-labelledby="verify-heading" className="flex flex-col gap-3">
                <h2 id="verify-heading" className="text-title-3 font-semibold tracking-tight">
                  2. {secondReview ? "Second review" : "Verify"}
                </h2>
                {mineFirst ? (
                  <Alert tone="info">You did the first review. A different reviewer has to complete it.</Alert>
                ) : (
                  <VerifyForm recordId={r.id} secondReview={secondReview} />
                )}
              </section>
              <section aria-labelledby="decline-heading" className="flex flex-col gap-3">
                <h2 id="decline-heading" className="text-title-3 font-semibold tracking-tight">
                  Or send it back
                </h2>
                <NegativeDecisionForm recordId={r.id} reasons={reasonOptions} />
              </section>
            </>
          ) : null}

          {r.verificationStatus === "verified" && !detail.isOwn ? (
            <>
              {r.paymentStatus !== "confirmed" ? (
                <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
                  <h2 id="payment-heading" className="text-title-3 font-semibold tracking-tight">
                    Confirm the payment
                  </h2>
                  <PaymentConfirmationForm
                    recordId={r.id}
                    hasRemittance={detail.documents.some(
                      (d) => d.kind === "remittance_advice" && d.scanStatus === "clean",
                    )}
                  />
                </section>
              ) : null}
              <section aria-labelledby="reverse-heading" className="flex flex-col gap-3">
                <h2 id="reverse-heading" className="text-title-3 font-semibold tracking-tight">
                  Reverse the verification
                </h2>
                {openReversal ? (
                  <Alert tone="info">A reversal is waiting for another reviewer in Reversals.</Alert>
                ) : (
                  <ProposeReversalForm recordId={r.id} reasons={reasonOptions} />
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </BrandWorkShell>
  );
}
