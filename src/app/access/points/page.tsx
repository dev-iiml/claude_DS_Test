import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, MetricBlock, PageHeader } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { getPointsSummary } from "@/modules/rewards/ledger-service";
import { EARN_RULES, EARN_RULE_CODES, POINTS_TERMS, formatPoints } from "@/modules/rewards/rules";

import { requireMember } from "../../_lib/member";
import { CreatorShell } from "../../_components/creator-shell";
import { fullDate } from "../_lib/present";

export const metadata: Metadata = { title: "Creator Points" };

const signed = (n: number) => `${n > 0 ? "+" : "−"}${new Intl.NumberFormat("en-IN").format(Math.abs(n))}`;

export default async function PointsPage() {
  const { passport } = await requireMember();
  const db = getDb();
  const points = await getPointsSummary(db, passport.creatorId);

  return (
    <CreatorShell>
      <BackLink href="/access" label="Access" />
      <PageHeader title="Creator Points" description="Simulated membership points for requesting Access." />

      <div className="flex max-w-2xl flex-col gap-8">
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <MetricBlock label="Available" value={new Intl.NumberFormat("en-IN").format(points.balance)} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <MetricBlock label="Held for requests" value={new Intl.NumberFormat("en-IN").format(points.onHold)} />
            </CardContent>
          </Card>
        </div>

        <ListGroup id="history" label="History">
          {points.history.length ? (
            points.history.map((e) => (
              <ListRow
                key={e.id}
                label={e.label}
                detail={fullDate.format(e.occurredAt)}
                value={<span className="tabular-nums">{signed(e.amount)}</span>}
              />
            ))
          ) : (
            <ListRow label="No points yet" detail="Points arrive as you reach membership milestones." />
          )}
        </ListGroup>

        <ListGroup id="earn" label="How you earn points" footer="Each is earned once.">
          {EARN_RULE_CODES.map((code) => (
            <ListRow key={code} label={EARN_RULES[code].label} value={formatPoints(EARN_RULES[code].points)} />
          ))}
        </ListGroup>

        <ul className="flex list-disc flex-col gap-1 pl-5 text-footnote text-ink-subtle">
          {POINTS_TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </CreatorShell>
  );
}
