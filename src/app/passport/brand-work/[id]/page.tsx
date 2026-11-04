import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BackLink, ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { bankMatchAvailable, getRecordForCreator } from "@/modules/brand-work";
import { DOCUMENT_KINDS, MAX_DOCUMENTS_PER_RECORD, type ConfirmationMethod } from "@/modules/brand-work/domain";
import {
  BILLED_PARTY_LABELS,
  CONFIRMATION_METHOD_COPY,
  DELIVERABLE_LABELS,
  DOCUMENT_KIND_LABELS,
  INDUSTRY_LABELS,
  PAYMENT_STATUS_COPY,
  PLATFORM_LABELS,
  VERIFICATION_STATUS_COPY,
  formatMonth,
  formatPaise,
} from "@/modules/brand-work/presentation";
import { CONSENT_KEYS } from "@/modules/consent";
import { EARN_GUIDE } from "@/modules/rewards/presentation";

import { requireMember } from "../../../_lib/member";
import { CreatorShell } from "../../../_components/creator-shell";
import { PageTitle } from "../../../_components/page-title";
import { pendingConsent } from "../_lib";
import { ConfirmationForm, DeleteDraftForm, SubmitRecordForm } from "./forms";

export const metadata: Metadata = { title: "Brand work" };

const NOTICES: Record<string, { tone: "success" | "neutral" | "danger"; text: string }> = {
  created: { tone: "success", text: "Record saved. Add a document, then send it for verification." },
  saved: { tone: "success", text: "Changes saved." },
  submitted: {
    tone: "success",
    text: "Sent for verification. We'll check your files, then a reviewer will look at it.",
  },
  uploaded: { tone: "success", text: "Document added." },
  upload_failed: { tone: "danger", text: "We couldn't add that file." },
  requested: { tone: "success", text: "Thanks — a reviewer will confirm the payment." },
  match_seen: { tone: "success", text: "Payment found in your shared bank data and confirmed." },
  match_not_seen: {
    tone: "neutral",
    text: "We didn't find this payment in your shared bank data. You can choose another way to confirm it.",
  },
  match_unknown: {
    tone: "neutral",
    text: "We couldn't check: there's no current bank data shared for an eligibility check. You can choose another way to confirm it.",
  },
};

const UPLOAD_ERRORS: Record<string, string> = {
  file_rejected: "Upload a PDF, JPEG or PNG, up to 10 MB.",
  too_many_documents: "A record can have up to 5 documents.",
  wrong_state: "You can't add documents while the record is being reviewed.",
  uploads_paused: "Uploads are paused for the moment. Please try again later.",
  consent_required: "Give the Verified brand work consent to add documents.",
  invalid: "Choose what kind of document this is.",
  rate_limited: "Too many uploads. Please wait a little and try again.",
  not_found: "We couldn't find that record.",
};

const day = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export default async function BrandWorkRecordPage({ params, searchParams }: PageProps<"/passport/brand-work/[id]">) {
  const { user } = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const r = await getRecordForCreator(db, user.userId, id);
  if (!r) notFound();
  const q = await searchParams;
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;
  const uploadError = typeof q.error === "string" ? (UPLOAD_ERRORS[q.error] ?? UPLOAD_ERRORS.file_rejected!) : null;
  const status = VERIFICATION_STATUS_COPY[r.verificationStatus];
  const editable = r.verificationStatus === "draft" || r.verificationStatus === "needs_info";
  const verified = r.verificationStatus === "verified";
  const canUploadEvidence = editable && r.documents.length < MAX_DOCUMENTS_PER_RECORD;
  const canUploadRemittance =
    verified && r.paymentStatus !== "confirmed" && r.documents.length < MAX_DOCUMENTS_PER_RECORD;
  const bankOn = verified && r.paymentStatus !== "confirmed" ? await bankMatchAvailable(db) : false;
  const methods: ConfirmationMethod[] = [
    "agency_confirmation",
    "remittance_advice",
    ...(bankOn ? (["aa_match"] as const) : []),
  ];
  const bankConsent = bankOn ? await pendingConsent(user.userId, CONSENT_KEYS.brandPaymentMatch) : null;
  const paymentPoints = EARN_GUIDE.find((g) => g.key === "brand_work")!.rows.filter((row) =>
    row.label.includes("payment"),
  );
  const pointsLine = `Confirmed payments earn the same Creator Points whichever you choose (${paymentPoints
    .map((p) => `${p.label.toLowerCase()}: ${p.points}`)
    .join(" · ")}).`;
  const kinds = DOCUMENT_KINDS.filter((k) =>
    canUploadEvidence ? k !== "remittance_advice" : k === "remittance_advice",
  );

  return (
    <CreatorShell>
      <BackLink href="/passport/brand-work" label="Verified brand work" />
      <PageTitle
        eyebrow={formatMonth(r.workDate)}
        title={r.brandName ?? r.endBrandName}
        description={r.description}
        status={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      />
      <div className="flex max-w-2xl flex-col gap-8">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {uploadError ? <Alert tone="danger">{uploadError}</Alert> : null}
        {r.message ? <Alert tone="warning">{r.message}</Alert> : null}

        <ListGroup id="status" label="Status" footer={status.detail}>
          {r.submittedAt ? <ListRow label="Sent" value={day.format(r.submittedAt)} /> : null}
          {r.verifiedAt ? <ListRow label="Verified" value={day.format(r.verifiedAt)} /> : null}
          {verified ? (
            <ListRow
              label="Payment"
              value={PAYMENT_STATUS_COPY[r.paymentStatus]}
              detail={
                r.paymentStatus === "confirmed" && r.paymentConfirmationMethod && r.paymentConfirmedMonth
                  ? `${CONFIRMATION_METHOD_COPY[r.paymentConfirmationMethod].label} · ${formatMonth(r.paymentConfirmedMonth)}`
                  : r.requestedConfirmation && r.paymentStatus === "unconfirmed"
                    ? `You chose: ${CONFIRMATION_METHOD_COPY[r.requestedConfirmation].label}`
                    : undefined
              }
            />
          ) : null}
        </ListGroup>

        <ListGroup
          id="details"
          label="Details"
          action={
            editable ? (
              <Link href={`/passport/brand-work/${r.id}/edit`} className="text-subhead text-gold">
                Edit
              </Link>
            ) : undefined
          }
        >
          <ListRow label="Brand" value={r.endBrandName} />
          <ListRow
            label="Billed to"
            value={r.billedPartyType === "brand" ? BILLED_PARTY_LABELS.brand : r.billedPartyName}
          />
          {r.industryCode ? (
            <ListRow label="Industry" value={INDUSTRY_LABELS[r.industryCode] ?? r.industryCode} />
          ) : null}
          <ListRow label="Platforms" value={r.platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")} />
          <ListRow
            label="Deliverables"
            value={r.deliverables.map((d) => DELIVERABLE_LABELS[d]).join(", ")}
            detail={r.deliverablesSummary ?? undefined}
          />
          {r.invoiceDate ? (
            <ListRow label="Invoice date" value={day.format(new Date(`${r.invoiceDate}T00:00:00Z`))} />
          ) : null}
          {r.invoiceAmountPaise !== null ? (
            <ListRow label="Invoice amount" value={formatPaise(r.invoiceAmountPaise)} />
          ) : null}
          <ListRow label="On your Passport" value={r.visibility === "private" ? "Private" : "Shown"} />
        </ListGroup>

        <ListGroup
          id="documents"
          label="Documents"
          footer="PDF, JPEG or PNG, up to 10 MB each. We don't keep the file name."
        >
          {r.documents.length ? (
            r.documents.map((d) => (
              <ListRow
                key={d.id}
                label={DOCUMENT_KIND_LABELS[d.kind]}
                detail={`${kb(d.sizeBytes)} · added ${day.format(d.uploadedAt)}`}
                accessory={
                  <StatusBadge
                    tone={d.scanStatus === "clean" ? "success" : d.scanStatus === "pending" ? "info" : "danger"}
                  >
                    {d.scanStatus === "clean" ? "Ready" : d.scanStatus === "pending" ? "Checking" : "Couldn't use"}
                  </StatusBadge>
                }
              />
            ))
          ) : (
            <ListRow label="No documents yet" detail="Add an invoice, purchase order or agreement." />
          )}
        </ListGroup>

        {canUploadEvidence || canUploadRemittance ? (
          <form
            method="post"
            encType="multipart/form-data"
            action={`/passport/brand-work/${r.id}/documents`}
            className="flex flex-col gap-4 rounded-lg bg-surface p-4 ring-1 ring-line ring-inset"
          >
            <p className="text-body font-medium">{canUploadEvidence ? "Add a document" : "Upload remittance advice"}</p>
            {kinds.length > 1 ? (
              <label className="flex flex-col gap-1">
                <span className="text-footnote text-ink-muted">Document type</span>
                <select
                  name="kind"
                  className="h-11 rounded-control bg-elevated px-3 text-body ring-1 ring-line ring-inset sm:max-w-xs"
                  defaultValue={kinds[0]}
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {DOCUMENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="kind" value={kinds[0]} />
            )}
            <label className="flex flex-col gap-1">
              <span className="text-footnote text-ink-muted">File</span>
              <input
                type="file"
                name="file"
                accept="application/pdf,image/jpeg,image/png"
                required
                className="text-subhead"
              />
            </label>
            <div>
              <Button type="submit" variant="secondary" size="sm">
                Upload
              </Button>
            </div>
          </form>
        ) : null}

        {editable ? <SubmitRecordForm recordId={r.id} resubmit={r.verificationStatus === "needs_info"} /> : null}

        {verified && r.paymentStatus !== "confirmed" ? (
          <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
            <h2 id="payment-heading" className="text-title-3 font-semibold tracking-tight">
              Confirm the payment
            </h2>
            <p className="text-subhead text-ink-muted">Optional. Choose whichever is easiest for you.</p>
            <ConfirmationForm recordId={r.id} methods={methods} bankConsent={bankConsent} pointsLine={pointsLine} />
          </section>
        ) : null}

        {r.verificationStatus === "draft" ? <DeleteDraftForm recordId={r.id} /> : null}
      </div>
    </CreatorShell>
  );
}
