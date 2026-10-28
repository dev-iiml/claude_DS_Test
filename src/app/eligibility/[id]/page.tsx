import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getFinancialCapacity } from "@/modules/financial-eligibility/application-service";
import { hasUnderwritingRun } from "@/modules/underwriting/underwriting-service";
import { CONSENT_KEYS, getActiveDefinition } from "@/modules/consent";
import { getCreatorLenderView } from "@/modules/lending";
import {
  FIN_FEATURE_COPY,
  formatFinValue,
  formatInr,
  purposesSummary,
} from "@/modules/financial-eligibility/presentation";

import { recordAfterResponse } from "../../_lib/analytics";
import { prepareRecommendationAction } from "../actions";
import { DiscardCheck } from "../_lib/discard";
import { EligibilityFrame } from "../_lib/frame";
import { loadApplicationStep } from "../_lib/load";
import { backFor, stepPath } from "../_lib/steps";
import { lenderBadge } from "../_lib/lender-badge";
import { LenderSection } from "./lender-section";

export const metadata: Metadata = { title: "Check complete" };

const GROUPS = [
  { key: "credit", label: "Credit history", footer: "From a partner credit bureau summary." },
  {
    key: "cashflow",
    label: "Bank cashflow",
    footer:
      "From the accounts you shared through the Account Aggregator. Transfers between your own accounts are left out.",
  },
  { key: "declared", label: "What you told us", footer: "Self-declared, compared with bank data where available." },
] as const;

export default async function SummaryPage({ params }: PageProps<"/eligibility/[id]">) {
  const { id } = await params;
  const { user, app } = await loadApplicationStep(id, "summary");
  if (app.status === "draft") redirect(stepPath(app));
  const capacity = await getFinancialCapacity(getDb(), { userId: user.userId, applicationId: app.id });
  const open = app.status === "inputs_ready";
  const prepared = await hasUnderwritingRun(getDb(), app.id);
  const lender = await getCreatorLenderView(getDb(), { userId: user.userId, applicationId: app.id });
  const sharingDefinition =
    lender.stage === "not_shared" ? await getActiveDefinition(getDb(), CONSENT_KEYS.lenderSharing) : null;
  const handoffDefinition =
    lender.stage === "decided" && lender.offer?.state === "open"
      ? await getActiveDefinition(getDb(), CONSENT_KEYS.lenderHandoff)
      : null;
  const withLender = app.status === "submitted";
  if (lender.stage === "decided" && lender.offer?.state === "open") {
    // Optional screen-view measurement: recorded only with the Product analytics consent.
    recordAfterResponse({ event: "offer_viewed", userId: user.userId, props: { simulated: lender.simulated } });
  }

  // Once a partner lender has decided, the decision (and any offer) leads the page.
  const lenderFirst = lender.stage === "decided";
  const badge = withLender ? lenderBadge(lender) : null;
  const lenderSection = (
    <LenderSection
      applicationId={app.id}
      view={lender}
      open={open && prepared}
      definition={
        sharingDefinition
          ? {
              id: sharingDefinition.id,
              title: sharingDefinition.title,
              purpose: sharingDefinition.purpose,
              body: sharingDefinition.body,
              version: sharingDefinition.version,
            }
          : null
      }
      handoffDefinition={
        handoffDefinition
          ? {
              id: handoffDefinition.id,
              title: handoffDefinition.title,
              purpose: handoffDefinition.purpose,
              body: handoffDefinition.body,
              version: handoffDefinition.version,
            }
          : null
      }
    />
  );

  return (
    <EligibilityFrame
      step="summary"
      back={backFor(app, "summary")}
      title={
        open
          ? "Check complete"
          : withLender
            ? lender.stage === "decided"
              ? lender.offer?.state === "open"
                ? "Your offer"
                : "Partner-lender decision"
              : "With a partner lender"
            : "Your check"
      }
      description={
        open
          ? "Your inputs are confirmed. Below is your Financial Capacity — the financial picture a partner lender would look at. Your CreatorCo recommendation also weighs your creator business."
          : withLender
            ? lender.stage === "decided" && lender.offer?.state === "open"
              ? "A partner lender has made you an offer. Read its Key Fact Statement before you answer."
              : lender.stage === "decided" && lender.offer?.state === "accepted"
                ? "You accepted this offer. The next steps are with the partner lender."
                : "This check was sent to a partner lender as a credit proposal, so it can't be changed now."
            : "This check is no longer open."
      }
    >
      <div className="flex flex-col gap-8">
        {lenderFirst ? lenderSection : null}
        <ListGroup
          id="request"
          label="Your request"
          action={
            open ? (
              <Link
                href={`/eligibility/${app.id}/details`}
                className="text-[15px] text-gold"
                aria-label="Edit your details"
              >
                Edit
              </Link>
            ) : null
          }
          footer={open ? "Changing anything sends the check back to Review, where you confirm again." : undefined}
        >
          <ListRow
            label="For"
            value={
              app.purposes.length ? purposesSummary(app.purposes) : app.purpose ? purposesSummary([app.purpose]) : "—"
            }
            detail={app.purposeNote ?? undefined}
          />
          <ListRow label="Amount" value={app.requestedAmount !== null ? formatInr(app.requestedAmount) : "—"} />
          <ListRow
            label="Status"
            accessory={
              <StatusBadge tone={badge ? badge.tone : open ? "success" : "neutral"}>
                {badge
                  ? badge.label
                  : open
                    ? "Confirmed"
                    : app.status === "expired"
                      ? "Expired"
                      : app.status === "submitted"
                        ? "With a partner lender"
                        : "Closed"}
              </StatusBadge>
            }
          />
        </ListGroup>

        {capacity ? (
          GROUPS.map((g) => {
            const items = capacity.features.filter((f) => FIN_FEATURE_COPY[f.key]?.group === g.key);
            if (g.key === "cashflow" && items.every((f) => f.value === null || f.value === 0 || f.value === "none")) {
              return (
                <ListGroup
                  key={g.key}
                  id={`fin-${g.key}`}
                  label={g.label}
                  action={
                    open ? (
                      <Link href={stepPath(app, "bank")} className="text-[15px] text-gold">
                        Share
                      </Link>
                    ) : null
                  }
                >
                  <ListRow
                    label="No bank data shared"
                    detail="Without it we can't verify your income, so your recommendation won't include an amount."
                  />
                </ListGroup>
              );
            }
            return (
              <ListGroup
                key={g.key}
                id={`fin-${g.key}`}
                label={g.label}
                footer={g.footer}
                action={
                  open && g.key === "cashflow" ? (
                    <Link
                      href={stepPath(app, "bank")}
                      className="text-[15px] text-gold"
                      aria-label="Change bank accounts"
                    >
                      Edit
                    </Link>
                  ) : null
                }
              >
                {items.map((f) => (
                  <ListRow key={f.key} label={FIN_FEATURE_COPY[f.key].label} value={formatFinValue(f.key, f.value)} />
                ))}
              </ListGroup>
            );
          })
        ) : (
          <ListGroup id="erased" label="Financial inputs">
            <ListRow label="Erased" detail="This check's financial inputs are no longer held." />
          </ListGroup>
        )}

        <ListGroup id="next" label="What happens next">
          <ListRow
            label="CreatorCo recommendation"
            detail={
              prepared
                ? "Prepared from your Financial Capacity and your creator business. A partner lender reviews it under its own policy before any offer."
                : "Combines your Financial Capacity with your creator business. Subject to partner-lender approval."
            }
            accessory={
              <StatusBadge tone={prepared ? "success" : "neutral"}>
                {prepared ? "Prepared" : "Not prepared"}
              </StatusBadge>
            }
          />
          {lender.stage === "not_shared" ? (
            <ListRow
              label="Nothing is sent to a lender yet"
              detail="That needs a separate consent from you — see below."
            />
          ) : null}
        </ListGroup>

        {lenderFirst ? null : lenderSection}

        {open && !prepared && capacity ? (
          <form action={prepareRecommendationAction}>
            <input type="hidden" name="applicationId" value={app.id} />
            <Button type="submit" variant="secondary">
              Prepare recommendation
            </Button>
          </form>
        ) : null}

        {open ? <DiscardCheck applicationId={app.id} expiresAt={app.expiresAt} /> : null}
      </div>
    </EligibilityFrame>
  );
}
