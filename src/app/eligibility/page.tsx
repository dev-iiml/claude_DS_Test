import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getOpenApplication, listApplications } from "@/modules/financial-eligibility/application-service";
import { PURPOSE_LABELS, purposesSummary } from "@/modules/financial-eligibility/presentation";
import { getCreatorLenderView } from "@/modules/lending";

import { requireMember } from "../_lib/member";
import { CreatorShell } from "../_components/creator-shell";
import { lenderBadge } from "./_lib/lender-badge";
import { stepPath } from "./_lib/steps";

export const metadata: Metadata = { title: "Financial eligibility" };

const STATUS = {
  draft: { tone: "info", label: "In progress" },
  inputs_ready: { tone: "success", label: "Check complete" },
  submitted: { tone: "brand", label: "With a partner lender" },
  withdrawn: { tone: "neutral", label: "Closed" },
  expired: { tone: "neutral", label: "Expired" },
} as const;

const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const HOW = [
  { label: "Tell us what it's for", detail: "Up to three purposes, the amount, your income and any EMIs." },
  {
    label: "A credit bureau check",
    detail: "Through a partner. We keep a summary, never the report or your full PAN.",
  },
  {
    label: "Your bank accounts",
    detail:
      "Statements for the accounts you choose, via an Account Aggregator — across more than one number if you need.",
  },
  {
    label: "Review and confirm",
    detail: "Check everything, then we prepare your Financial Capacity and a CreatorCo recommendation.",
  },
];

export default async function EligibilityPage({ searchParams }: PageProps<"/eligibility">) {
  const { user } = await requireMember();
  const db = getDb();
  const open = await getOpenApplication({ db }, user.userId);
  const past = await Promise.all(
    (await listApplications(db, user.userId))
      .filter((a) => a.id !== open?.id)
      .map(async (a) => ({
        ...a,
        // Checks sent to a partner lender stay viewable: their status and, once reviewed, the decision.
        lender:
          a.status === "submitted"
            ? lenderBadge(await getCreatorLenderView(db, { userId: user.userId, applicationId: a.id }))
            : null,
      })),
  );
  const q = await searchParams;

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="Creator business finance"
        title="Financial eligibility"
        description="Your influence opens doors. Your business earns the limit."
      />
      <div className="flex max-w-2xl flex-col gap-8">
        {q.discarded || q.closed ? (
          <Alert tone="neutral">Check discarded. Its financial inputs have been erased.</Alert>
        ) : null}

        {open ? (
          <ListGroup id="current" label="Your check">
            <ListRow
              href={stepPath(open)}
              label={open.purposes.length ? purposesSummary(open.purposes) : "Eligibility check"}
              detail={`Started ${date.format(open.createdAt)} · expires ${date.format(open.expiresAt)} unless sent to a lender`}
              accessory={<StatusBadge tone={STATUS[open.status].tone}>{STATUS[open.status].label}</StatusBadge>}
            />
          </ListGroup>
        ) : (
          <>
            <ListGroup id="how" label="How it works" footer="Takes about five minutes. You can stop and come back.">
              {HOW.map((h, i) => (
                <ListRow
                  key={h.label}
                  leading={
                    <span className="flex size-7 items-center justify-center rounded-full bg-elevated text-[13px] font-semibold text-gold tabular-nums">
                      {i + 1}
                    </span>
                  }
                  label={h.label}
                  detail={h.detail}
                />
              ))}
            </ListGroup>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/eligibility/start">Check financial eligibility</Link>
            </Button>
          </>
        )}

        {past.length ? (
          <ListGroup
            id="past"
            label="Past checks"
            footer="Open a check sent to a partner lender to see where it is and the decision. Closed and expired checks keep only their status and dates."
          >
            {past.map((a) => (
              <ListRow
                key={a.id}
                href={a.lender ? `/eligibility/${a.id}` : undefined}
                label={a.purpose ? PURPOSE_LABELS[a.purpose] : "Eligibility check"}
                detail={`Started ${date.format(a.createdAt)}${a.closedAt ? ` · ${STATUS[a.status].label.toLowerCase()} ${date.format(a.closedAt)}` : ""}`}
                accessory={
                  <StatusBadge tone={(a.lender ?? STATUS[a.status]).tone}>
                    {(a.lender ?? STATUS[a.status]).label}
                  </StatusBadge>
                }
              />
            ))}
          </ListGroup>
        ) : null}

        <p className="px-1 text-[13px] leading-snug text-ink-subtle">
          Checking eligibility doesn&rsquo;t commit you to anything. Any eligibility shown will be a CreatorCo
          recommendation, subject to partner-lender approval.
        </p>
      </div>
    </CreatorShell>
  );
}
