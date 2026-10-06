import { ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import { formatInr } from "@/modules/financial-eligibility/presentation";
import type { CreatorLenderView } from "@/modules/lending";
import { DECISION_LABELS, OFFER_DECLINE_REASON_LABELS, kfsRows } from "@/modules/lending/presentation";

import { AcceptOfferForm, DeclineOfferForm } from "./offer-forms";
import { ShareForm } from "./share-form";

type Definition = { id: string; title: string; purpose: string; body: string; version: number };

const day = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});
const shortDay = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * The check's journey to a partner lender, as the creator sees it. Reviews
 * before sending look like any other preparation; a decision appears only
 * after a CreatorCo reviewer has checked it.
 */
export function LenderSection({
  applicationId,
  view,
  open,
  definition,
  handoffDefinition,
}: {
  applicationId: string;
  view: CreatorLenderView;
  open: boolean;
  definition: Definition | null;
  /** The "Continue with the partner lender" consent, shown with an open offer. */
  handoffDefinition?: Definition | null;
}) {
  if (view.stage === "not_shared") {
    if (!open || !definition) return null;
    return (
      <section aria-labelledby="share-heading" className="flex flex-col gap-3">
        <h2 id="share-heading" className="px-1 text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
          Share with a partner lender
        </h2>
        <p className="px-1 text-[15px] leading-snug text-ink-muted">
          A regulated partner bank or NBFC can look at this check and decide whether to make an offer. It needs your
          consent, and applies to checks you confirm later too, until you withdraw it.
        </p>
        <ShareForm applicationId={applicationId} definition={definition} />
      </section>
    );
  }
  if (view.stage === "closed") {
    return (
      <ListGroup id="lender" label="Partner lender">
        <ListRow
          label="Closed"
          detail="This check's lender records were erased at your request. The partner lender keeps its own copy under its legal retention rules."
        />
      </ListGroup>
    );
  }
  if (view.stage === "preparing" || view.stage === "with_lender") {
    return (
      <ListGroup
        id="lender"
        label="Partner lender"
        footer="The partner lender decides under its own credit policy. CreatorCo is not a lender."
      >
        <ListRow
          label={view.stage === "preparing" ? "Preparing to send" : "With a partner lender"}
          detail={
            view.stage === "preparing"
              ? "Your check is being prepared as a credit proposal."
              : "Awaiting their decision. We'll show it here once it has been checked."
          }
          accessory={<StatusBadge tone="info">{view.stage === "preparing" ? "Preparing" : "Sent"}</StatusBadge>}
        />
      </ListGroup>
    );
  }
  const label = DECISION_LABELS[view.outcome];
  const offer = view.offer;
  const decision = (
    <ListGroup
      id="lender"
      label="Partner-lender decision"
      action={view.simulated ? <StatusBadge tone="warning">Simulated pilot</StatusBadge> : undefined}
      footer={[
        view.adjusted
          ? "The partner lender's decision was adjusted after CreatorCo's review — never to more than the lender decided."
          : "Decided by the partner lender under its own credit policy and checked by CreatorCo.",
        view.outcome === "declined"
          ? "It doesn't affect your Creator Status. You can start a new check later."
          : "Any offer is subject to the lender's final checks and documents. CreatorCo is not a lender.",
      ].join(" ")}
    >
      <ListRow
        label="Decision"
        accessory={<StatusBadge tone={view.outcome === "declined" ? "neutral" : "success"}>{label}</StatusBadge>}
      />
      {view.amount !== null ? <ListRow label="Amount" value={formatInr(view.amount)} /> : null}
      {view.tenorMonths !== null ? <ListRow label="Tenor" value={`${view.tenorMonths} months`} /> : null}
    </ListGroup>
  );
  if (!offer) return decision;

  const t = offer.terms;
  const lender = t.lenderName;
  return (
    <div className="flex flex-col gap-8">
      {decision}

      <ListGroup
        id="offer"
        label={`Offer from ${lender}`}
        action={
          <StatusBadge tone={offer.state === "open" ? "brand" : offer.state === "accepted" ? "success" : "neutral"}>
            {offer.state === "open"
              ? `Until ${shortDay.format(offer.expiresAt)}`
              : offer.state === "accepted"
                ? "Accepted"
                : offer.state === "declined"
                  ? "Declined"
                  : "Expired"}
          </StatusBadge>
        }
        footer={
          view.simulated
            ? "Simulated pilot: illustrative terms from the pilot's simulated lender. No loan will be made."
            : `These terms are ${lender}'s, as it provided them. CreatorCo is not a lender.`
        }
      >
        {offer.state === "open" ? <ListRow label="Valid until" value={day.format(offer.expiresAt)} /> : null}
        <ListRow label="Amount" value={formatInr(t.sanctionedAmount)} />
        <ListRow label="Monthly instalment" value={`${formatInr(t.emiAmount)} × ${t.emiCount}`} />
        <ListRow label="Interest rate" value={`${t.annualInterestRatePct}% a year`} />
        <ListRow label="APR (all-in yearly cost)" value={`${t.aprPct}%`} />
        <ListRow label="Total you repay" value={formatInr(t.totalRepayable)} />
      </ListGroup>

      <details className="rounded-control px-1" open={offer.state === "open"} aria-label="Key Fact Statement">
        <summary className="cursor-pointer text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
          Key Fact Statement
        </summary>
        <div className="mt-3">
          <ListGroup
            id="kfs"
            footer="Read this before you accept. The lender's loan agreement, which you sign with the lender, is what binds you."
          >
            {kfsRows(t).map((r) => (
              <ListRow key={r.label} label={r.label} value={r.value} />
            ))}
            {t.termsUrl ? (
              <ListRow
                label="Full terms"
                value={
                  <a href={t.termsUrl} target="_blank" rel="noreferrer noopener" className="text-gold">
                    Open
                  </a>
                }
              />
            ) : null}
          </ListGroup>
        </div>
      </details>

      {offer.state === "open" && handoffDefinition ? (
        <section aria-labelledby="accept-heading" className="flex flex-col gap-4">
          <h2 id="accept-heading" className="px-1 text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
            Your answer
          </h2>
          <p className="px-1 text-[15px] leading-snug text-ink-muted">
            {view.simulated
              ? "This is the pilot's simulated lender: accepting records your answer so you can see how the journey works. No loan will be made and no lender will contact you."
              : `Accepting tells ${lender} you'd like to go ahead. It then completes its own checks and asks you to sign its loan agreement — nothing is final until you sign, and you can still exit during the ${t.coolingOffDays}-day cooling-off period.`}
          </p>
          <AcceptOfferForm
            applicationId={applicationId}
            termsHash={offer.termsHash}
            lenderName={lender}
            definition={handoffDefinition}
          />
          <DeclineOfferForm applicationId={applicationId} />
        </section>
      ) : null}

      {offer.state === "accepted" ? (
        <ListGroup id="next-steps" label={`Next steps with ${lender}`}>
          <ListRow
            label="You accepted this offer"
            detail={`${offer.respondedAt ? day.format(offer.respondedAt) : ""} · ${
              view.simulated
                ? "Simulated pilot — no lender will contact you."
                : `${lender} will contact you to complete its checks (such as KYC) and to sign the loan agreement.`
            }`}
          />
        </ListGroup>
      ) : null}
      {offer.state === "declined" ? (
        <ListGroup id="next-steps" label="Your answer">
          <ListRow
            label="You declined this offer"
            detail={[
              offer.respondedAt ? day.format(offer.respondedAt) : null,
              offer.declineReason ? OFFER_DECLINE_REASON_LABELS[offer.declineReason] : null,
              "You can start a new check whenever you like.",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </ListGroup>
      ) : null}
      {offer.state === "expired" ? (
        <ListGroup id="next-steps" label="Your answer">
          <ListRow label="This offer expired" detail="You can start a new check whenever you like." />
        </ListGroup>
      ) : null}
    </div>
  );
}
