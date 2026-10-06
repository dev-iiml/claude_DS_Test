import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { readyToConfirm } from "@/modules/financial-eligibility/application-service";
import { getBankOverview } from "@/modules/financial-eligibility/cashflow-service";
import type { CashflowCoverage, IncomeSource, MissingAccountReason } from "@/modules/financial-eligibility/domain";
import {
  BUREAU_BAND_LABELS,
  COVERAGE_LABELS,
  INCOME_SOURCE_LABELS,
  MISSING_REASON_LABELS,
  formatInr,
  purposesSummary,
} from "@/modules/financial-eligibility/presentation";

import { confirmCheckAction } from "../../actions";
import { DiscardCheck } from "../../_lib/discard";
import { EligibilityFrame } from "../../_lib/frame";
import { loadApplicationStep } from "../../_lib/load";
import { backFor, stepPath } from "../../_lib/steps";

export const metadata: Metadata = { title: "Review" };

function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-[15px] text-gold" aria-label={label}>
      Edit
    </Link>
  );
}

export default async function ReviewPage({ params, searchParams }: PageProps<"/eligibility/[id]/review">) {
  const { id } = await params;
  const q = await searchParams;
  const { user, app } = await loadApplicationStep(id, "review");
  const bank = (await getBankOverview(getDb(), { userId: user.userId, applicationId: app.id }))!;
  const skipped = app.cashflowStatus === "skipped";
  const numbers = bank.numbers.filter((n) => n.accounts.some((a) => a.status === "delivered")).length;

  return (
    <EligibilityFrame
      step="review"
      back={backFor(app, "review")}
      title="Review and confirm"
      description="Check everything before we prepare your CreatorCo recommendation. You can change anything until you confirm — and afterwards, by confirming again."
    >
      <div className="flex flex-col gap-8">
        {q.error ? <Alert tone="danger">We couldn&rsquo;t confirm your check. Please try again.</Alert> : null}

        <ListGroup
          id="review-details"
          label="Your details"
          action={<EditLink href={stepPath(app, "details")} label="Edit your details" />}
        >
          <ListRow label="For" value={purposesSummary(app.purposes)} detail={app.purposeNote ?? undefined} />
          <ListRow label="Amount" value={app.requestedAmount !== null ? formatInr(app.requestedAmount) : "—"} />
          <ListRow
            label="Monthly income you told us"
            value={app.declaredMonthlyIncome !== null ? formatInr(app.declaredMonthlyIncome) : "—"}
          />
          <ListRow
            label="Existing EMIs"
            value={app.declaredMonthlyEmi !== null ? formatInr(app.declaredMonthlyEmi) : "—"}
          />
          <ListRow
            label="Income sources"
            value={app.incomeSources.map((s) => INCOME_SOURCE_LABELS[s as IncomeSource] ?? s).join(", ")}
          />
        </ListGroup>

        <ListGroup
          id="review-credit"
          label="Credit check"
          action={
            <Link href={stepPath(app, "credit-check")} className="text-[15px] text-gold">
              View
            </Link>
          }
        >
          <ListRow
            label="Credit history"
            value={app.bureauScoreBand ? BUREAU_BAND_LABELS[app.bureauScoreBand] : "—"}
            detail={app.panMasked ? `PAN ${app.panMasked}` : undefined}
          />
        </ListGroup>

        <ListGroup
          id="review-bank"
          label="Bank accounts"
          action={<EditLink href={stepPath(app, "bank")} label="Edit your bank accounts" />}
          footer={
            skipped
              ? "Without bank data we can't verify your income, so your recommendation won't include an amount."
              : "Only income we can see in your bank data counts towards a recommendation."
          }
        >
          {skipped ? (
            <ListRow label="Not shared" detail="You chose to continue without bank data." />
          ) : (
            <>
              <ListRow
                label="Accounts shared"
                value={`${bank.accountsShared} from ${numbers} ${numbers === 1 ? "number" : "numbers"}`}
                detail={bank.accountsNotReceived ? `${bank.accountsNotReceived} not received` : undefined}
              />
              <ListRow
                label="Covers"
                value={bank.coverage ? COVERAGE_LABELS[bank.coverage as CashflowCoverage] : "—"}
                detail={
                  bank.missingAccountsReason
                    ? MISSING_REASON_LABELS[bank.missingAccountsReason as MissingAccountReason]
                    : undefined
                }
              />
            </>
          )}
        </ListGroup>

        {readyToConfirm(app) ? (
          <form action={confirmCheckAction} className="flex flex-col gap-3">
            <input type="hidden" name="applicationId" value={app.id} />
            <div>
              <Button type="submit" size="lg" className="w-full sm:w-auto">
                Confirm and prepare recommendation
              </Button>
            </div>
            <p className="px-1 text-[13px] leading-snug text-ink-subtle">
              We work out your Financial Capacity from exactly these inputs. Nothing is sent to a lender.
            </p>
          </form>
        ) : (
          <Alert tone="neutral">Finish the earlier steps to confirm.</Alert>
        )}

        <DiscardCheck applicationId={app.id} expiresAt={app.expiresAt} />
      </div>
    </EligibilityFrame>
  );
}
