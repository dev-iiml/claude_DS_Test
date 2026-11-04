import Link from "next/link";
import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { listRecordsForCreator, noticeText, noticesFor, portfolioForCreator } from "@/modules/brand-work";
import { INDUSTRY_LABELS, VERIFICATION_STATUS_COPY, formatMonth } from "@/modules/brand-work/presentation";
import { EARN_GUIDE } from "@/modules/rewards/presentation";
import { formatPoints } from "@/modules/rewards/rules";

import { requireMember } from "../../_lib/member";
import { CreatorShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Verified brand work" };

const NOTICES: Record<string, string> = { deleted: "Draft deleted." };

export default async function BrandWorkPage({ searchParams }: PageProps<"/passport/brand-work">) {
  const { user, passport } = await requireMember();
  const db = getDb();
  const [records, portfolio, notices] = await Promise.all([
    listRecordsForCreator(db, user.userId),
    portfolioForCreator(db, passport.creatorId),
    noticesFor(db, user.userId),
  ]);
  const q = await searchParams;
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;
  const brandPoints = EARN_GUIDE.find((g) => g.key === "brand_work")!;
  const verified = records.filter((r) => r.verificationStatus === "verified").length;

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageHeader
        title="Verified brand work"
        description="Your collaborations with brands, checked against your invoices, purchase orders or agreements. It builds your professional record — it isn't a credit product."
      />
      <div className="flex max-w-2xl flex-col gap-8">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {notices.map((n) => (
          <Alert key={n.kind} tone="neutral">
            {noticeText(n)}{" "}
            <Link href="/account/consents" className="text-gold underline underline-offset-2">
              Consent centre
            </Link>
          </Alert>
        ))}

        <div>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/passport/brand-work/new">Add brand work</Link>
          </Button>
        </div>

        <ListGroup
          id="records"
          label="Your records"
          footer={
            records.length
              ? `${verified} verified. Drafts and records you're still editing only you can see.`
              : undefined
          }
        >
          {records.length ? (
            records.map((r) => {
              const s = VERIFICATION_STATUS_COPY[r.verificationStatus];
              return (
                <ListRow
                  key={r.id}
                  href={`/passport/brand-work/${r.id}`}
                  label={r.brandName ?? r.endBrandName}
                  detail={[
                    formatMonth(r.workDate),
                    r.description,
                    r.visibility === "private" ? "Private" : null,
                    r.verificationStatus === "verified" && r.paymentStatus === "confirmed" ? "Payment confirmed" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  accessory={<StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
                />
              );
            })
          ) : (
            <ListRow label="No brand work yet" detail="Add a collaboration and the documents that back it." />
          )}
        </ListGroup>

        {portfolio.length ? (
          <ListGroup
            id="portfolio"
            label="Brands you've worked with"
            footer="Verified collaborations you show on your Passport. Private ones aren't listed."
          >
            {portfolio.map((b) => (
              <ListRow
                key={b.brandDirectoryId}
                label={b.displayName}
                detail={`${INDUSTRY_LABELS[b.industry] ?? b.industry} · ${b.firstMonth === b.lastMonth ? formatMonth(b.lastMonth) : `${formatMonth(b.firstMonth)} – ${formatMonth(b.lastMonth)}`}`}
                value={`${b.collaborations} ${b.collaborations === 1 ? "collaboration" : "collaborations"}`}
              />
            ))}
          </ListGroup>
        ) : null}

        <ListGroup id="how" label="How it works">
          <ListRow
            label="1. Add the collaboration"
            detail="The brand, who you billed, platforms, deliverables and dates."
          />
          <ListRow
            label="2. Upload a document"
            detail="An invoice, purchase order or agreement — PDF, JPEG or PNG, up to 10 MB."
          />
          <ListRow
            label="3. A CreatorCo reviewer checks it"
            detail="Against your documents. Verified records count in your brand signals."
          />
          <ListRow
            label="4. Confirm the payment (optional)"
            detail="Your agency confirms, you upload remittance advice, or — if available — we check bank data you already shared."
          />
        </ListGroup>

        <ListGroup id="points" label="Creator Points for brand work" footer={brandPoints.footer}>
          {brandPoints.rows.map((r) => (
            <ListRow key={r.label} label={r.label} value={formatPoints(r.points)} />
          ))}
        </ListGroup>

        <p className="px-4 text-footnote text-ink-subtle">
          Documents are stored privately and encrypted, under a random reference — we don&rsquo;t keep the file name or
          read text out of them. Only CreatorCo&rsquo;s brand-work reviewers open them, and every view is logged. To
          remove everything, withdraw the Verified brand work consent in{" "}
          <Link href="/account/consents/brand_work_records" className="text-gold underline underline-offset-2">
            Consent centre
          </Link>
          .
        </p>
      </div>
    </CreatorShell>
  );
}
