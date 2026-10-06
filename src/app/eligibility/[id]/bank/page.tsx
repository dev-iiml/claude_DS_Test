import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import type { Tone } from "@/components/creatorco/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import {
  MISSING_ACCOUNT_REASONS,
  type BankAccountType,
  type SharedAccountStatus,
} from "@/modules/financial-eligibility/domain";
import {
  capabilitiesOf,
  getBankOverview,
  maxNumbersFor,
  type BankNumberView,
} from "@/modules/financial-eligibility/cashflow-service";
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  MISSING_REASON_LABELS,
} from "@/modules/financial-eligibility/presentation";
import { getVerifiedMobile } from "@/modules/identity/mobile-verification";
import { getProviders } from "@/modules/integrations/registry";

import { retryBankSharingAction, skipBankAction } from "../../actions";
import { EligibilityFrame } from "../../_lib/frame";
import { loadApplicationStep } from "../../_lib/load";
import { backFor, stepPath } from "../../_lib/steps";
import { CoverageForm, ShareForm } from "./bank-forms";

export const metadata: Metadata = { title: "Bank accounts" };

const ERRORS: Record<string, { tone: "neutral" | "danger"; text: string }> = {
  provider_changed: { tone: "neutral", text: "Bank data sharing changed on our side. Please share again." },
  provider_error: { tone: "danger", text: "We couldn't fetch your bank data. Please try again." },
  number_limit: { tone: "neutral", text: "You've reached the number of sharing attempts for this check." },
  wrong_step: { tone: "neutral", text: "That number can't be tried again. Add it as a new number instead." },
};

const STATUS_TONE: Record<SharedAccountStatus, Tone> = {
  delivered: "success",
  pending: "info",
  timeout: "warning",
  denied: "neutral",
  failed: "warning",
};

const period = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const monthOf = (iso: string) => period.format(new Date(`${iso}T00:00:00Z`));

/** What happened for one number, when no account rows explain it. */
function sessionNote(n: BankNumberView): { label: string; detail: string } | null {
  const s = n.session;
  if (!s) return null;
  if (s.status === "pending" && !s.stale)
    return { label: "Waiting for you at the Account Aggregator", detail: "Finish there, or try again." };
  if (s.status === "pending" || s.status === "abandoned")
    return { label: "Not finished", detail: "The Account Aggregator journey wasn't completed." };
  if (n.accounts.length) return null;
  if (s.status === "no_accounts")
    return {
      label: "No accounts found for this number",
      detail:
        "Your bank may have a different mobile number on record, or it may not be on the Account Aggregator network yet. This doesn't mean we've assumed you have no income.",
    };
  if (s.status === "declined")
    return { label: "You didn't approve sharing", detail: "Nothing was shared from this number." };
  return { label: "Something went wrong", detail: "We didn't receive data for this number. You can try again." };
}

export default async function BankPage({ params, searchParams }: PageProps<"/eligibility/[id]/bank">) {
  const { id } = await params;
  const q = await searchParams;
  const { user, app } = await loadApplicationStep(id, "bank");
  const db = getDb();
  const provider = (await getProviders()).financialData;
  const caps = capabilitiesOf(provider);
  const overview = (await getBankOverview(db, {
    userId: user.userId,
    applicationId: app.id,
    currentProvider: provider.descriptor.key,
  }))!;
  const verified = await getVerifiedMobile(db, user.userId);
  const maxNumbers = maxNumbersFor(provider);
  const searched = overview.numbers.length > 0;
  const received = overview.accountsShared > 0;
  const canAddNumber = overview.numbersSearched < maxNumbers && overview.attemptsLeft > 0;
  const error = typeof q.error === "string" ? (ERRORS[q.error] ?? ERRORS.provider_error) : null;
  const confirmed = app.status === "inputs_ready";

  return (
    <EligibilityFrame
      step="bank"
      back={backFor(app, "bank")}
      title="Bank accounts"
      description="Share the accounts where your creator income lands. You approve it in a regulated Account Aggregator, not in CreatorCo — your bank login is never shared with us."
    >
      <div className="flex flex-col gap-8">
        {error ? <Alert tone={error.tone}>{error.text}</Alert> : null}
        {confirmed ? (
          <Alert tone="neutral">Adding accounts sends your check back to Review, where you confirm again.</Alert>
        ) : null}
        {provider.descriptor.mode === "mock" ? (
          <p className="rounded-[12px] bg-warning-soft px-4 py-3 text-[13px] leading-snug text-warning">
            Test mode — simulated Account Aggregator. Numbers ending in 0 find no accounts, 5 find three, 9 find two
            (one needs a retry); others find one or two.
          </p>
        ) : null}

        {overview.numbers.map((n) => {
          const note = sessionNote(n);
          return (
            <ListGroup
              key={n.key}
              id={`number-${n.key}`}
              label={`Mobile ending ${n.last4}`}
              footer={
                n.session?.canRetry ? (
                  <form action={retryBankSharingAction} className="pt-1">
                    <input type="hidden" name="applicationId" value={app.id} />
                    <input type="hidden" name="sessionId" value={n.session.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      {n.session.status === "completed" ? "Share more accounts" : "Try again"}
                    </Button>
                  </form>
                ) : undefined
              }
            >
              {n.accounts.map((a) => (
                <ListRow
                  key={a.id}
                  label={`${a.institution} · ${ACCOUNT_TYPE_LABELS[a.accountType as BankAccountType]} ••${a.maskedNumber.slice(-4)}`}
                  detail={
                    a.periodFrom && a.periodTo
                      ? `${monthOf(a.periodFrom)} – ${monthOf(a.periodTo)}`
                      : a.status === "timeout" || a.status === "failed"
                        ? "Try again — banks sometimes take a while to respond."
                        : undefined
                  }
                  accessory={
                    <StatusBadge tone={STATUS_TONE[a.status as SharedAccountStatus]}>
                      {ACCOUNT_STATUS_LABELS[a.status as SharedAccountStatus]}
                    </StatusBadge>
                  }
                />
              ))}
              {note ? <ListRow label={note.label} detail={note.detail} /> : null}
            </ListGroup>
          );
        })}

        {searched && !received && app.cashflowStatus !== "pending" ? (
          <ListGroup
            id="recovery"
            label="No bank data received yet"
            footer="Not finding an account never counts as having no income."
          >
            <ListRow
              label="Try the number your bank has on record"
              detail="Check your bank app, passbook or a recent bank SMS for the registered mobile number."
            />
            <ListRow
              label="Your bank may not be on the network yet"
              detail="Not every bank shares through Account Aggregators. If yours doesn't, you can continue without bank data."
            />
          </ListGroup>
        ) : null}

        {canAddNumber ? (
          <ShareForm
            applicationId={app.id}
            defaultMobile={searched ? null : (verified?.replace(/^\+91/, "") ?? null)}
            label={searched ? "Search another mobile number" : "Mobile number linked to your bank accounts"}
            description={
              searched
                ? "For accounts registered with a different number. The Account Aggregator will send it an OTP."
                : caps.additionalNumberInJourney
                  ? "The Account Aggregator sends this number an OTP and finds the accounts linked to it. You can add another number there, or here afterwards."
                  : "The Account Aggregator sends this number an OTP and finds the accounts linked to it. You can search another number here afterwards."
            }
            cta={searched ? "Search this number" : "Share via Account Aggregator"}
          />
        ) : searched ? (
          <p className="px-1 text-[13px] leading-snug text-ink-subtle">
            You&rsquo;ve searched the most numbers we can use for one check.
          </p>
        ) : null}

        {received ? (
          <CoverageForm
            applicationId={app.id}
            saved={{ allShared: overview.accountsCompleteDeclared, missingReason: overview.missingAccountsReason }}
            reasons={MISSING_ACCOUNT_REASONS.map((r) => ({ value: r, label: MISSING_REASON_LABELS[r] }))}
          />
        ) : null}

        <ListGroup id="what" label="What we receive" footer="Your bank login is never shared with CreatorCo.">
          <ListRow
            label="Statements for the accounts you choose"
            detail="The last 12 months. We use them to verify creator income — platform payouts, brand payments, affiliate income."
          />
          <ListRow
            label="Transfers between your own accounts are left out"
            detail="Moving money between your accounts never counts as income."
          />
          <ListRow
            label="Held securely, for a limited time"
            detail="Encrypted, used only for this check, and deleted when the Account Aggregator consent ends or the check closes."
          />
        </ListGroup>

        {!received ? (
          <div className="flex flex-col gap-2">
            <form action={skipBankAction}>
              <input type="hidden" name="applicationId" value={app.id} />
              <Button type="submit" size="lg" variant="ghost" className="w-full sm:w-auto">
                Continue without bank data
              </Button>
            </form>
            <p className="px-1 text-[13px] leading-snug text-ink-subtle">
              Without bank data we can&rsquo;t verify your income, so your CreatorCo recommendation won&rsquo;t include
              an amount. You can still come back and share before you confirm.
            </p>
          </div>
        ) : app.accountsCompleteDeclared !== null && !confirmed ? (
          <Link href={stepPath(app, "review")} className="px-1 text-[15px] text-gold">
            Back to review
          </Link>
        ) : null}
      </div>
    </EligibilityFrame>
  );
}
