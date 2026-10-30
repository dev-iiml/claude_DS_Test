import type { Metadata } from "next";

import { BackLink, CreatorStatusBadge, ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import {
  STATUS_CRITERION_LABELS,
  STATUS_NOT_CREDIT_NOTE,
  criterionRequirement,
  criterionValue,
} from "@/modules/creator-status/presentation";
import { CREATOR_STATUS_LABELS } from "@/modules/creator-status/status";

import { requireMember } from "@/app/_lib/member";
import { CreatorShell } from "@/app/_components/creator-shell";
import { PageTitle } from "@/app/_components/page-title";

export const metadata: Metadata = { title: "Creator Status" };

const STATE = {
  met: { label: "Met", tone: "success" },
  not_met: { label: "Not yet", tone: "neutral" },
  missing: { label: "Not measured", tone: "neutral" },
} as const;

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export default async function StatusPage() {
  const { passport } = await requireMember();
  const { status } = passport;
  const tiers = (["onyx", "icon"] as const).map((tier) => ({
    tier,
    criteria: status.criteria.filter((c) => c.tier === tier),
  }));

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageTitle
        title="Creator Status"
        description="Your professional standing in the CreatorCo network: Member, Onyx or Icon."
        status={<CreatorStatusBadge tier={status.tier} />}
      />

      <div className="flex max-w-2xl flex-col gap-8">
        <Alert tone="neutral">{STATUS_NOT_CREDIT_NOTE}</Alert>

        {status.basis === "no_signals" ? (
          <ListGroup id="get-started" label="How to be considered">
            <ListRow
              href="/passport/connect"
              label="Connect a social account"
              detail="Status is built from verified activity, not what&rsquo;s self-declared."
            />
            <ListRow
              href="/passport/signals"
              label="Turn on professional signals"
              detail="Status reads your signals — longevity, reach, engagement, consistency and authenticity."
            />
          </ListGroup>
        ) : (
          <p className="text-subhead text-ink-muted">
            Your Creator Status is {CREATOR_STATUS_LABELS[status.tier]}. Updated {dateTime.format(status.computedAt!)}{" "}
            from your latest professional signals.
          </p>
        )}

        {tiers.map(({ tier, criteria }) => (
          <ListGroup
            key={tier}
            id={`tier-${tier}`}
            label={`What ${CREATOR_STATUS_LABELS[tier]} looks for`}
            footer={
              tier === "icon"
                ? "Icon includes everything Onyx asks for, at a higher level."
                : "Every item must be met. A signal we can\u2019t measure yet counts as not met — never guessed."
            }
          >
            {criteria.map((c) => (
              <ListRow
                key={c.key}
                label={STATUS_CRITERION_LABELS[c.key]}
                detail={
                  c.state === "missing"
                    ? criterionRequirement(c)
                    : `${criterionRequirement(c)} · You: ${criterionValue(c)}`
                }
                accessory={<StatusBadge tone={STATE[c.state].tone}>{STATE[c.state].label}</StatusBadge>}
              />
            ))}
          </ListGroup>
        ))}

        <ListGroup
          id="rewards"
          label="Rewards"
          footer="Brand activity will count towards Status once it can be verified."
        >
          <ListRow
            href="/access/points"
            label="Creator Points"
            detail="Earned the first time you reach Onyx or Icon. See your points and how to earn more."
          />
        </ListGroup>
      </div>
    </CreatorShell>
  );
}
