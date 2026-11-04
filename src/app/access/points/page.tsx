import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, MetricBlock, PageHeader, StatusBadge } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { getPointsSummary } from "@/modules/rewards/ledger-service";
import { EARN_GUIDE } from "@/modules/rewards/presentation";
import { POINTS_TERMS, formatPoints } from "@/modules/rewards/rules";
import { listTasksForCreator } from "@/modules/rewards/tasks-service";
import { POINTS_TASK_CATEGORY_LABELS } from "@/modules/rewards/tasks-domain";

import { requireMember } from "../../_lib/member";
import { CreatorShell } from "../../_components/creator-shell";
import { fullDate } from "../_lib/present";

export const metadata: Metadata = { title: "Creator Points" };

const signed = (n: number) => `${n > 0 ? "+" : "−"}${new Intl.NumberFormat("en-IN").format(Math.abs(n))}`;

export default async function PointsPage() {
  const { passport } = await requireMember();
  const db = getDb();
  const [points, tasks] = await Promise.all([
    getPointsSummary(db, passport.creatorId),
    listTasksForCreator(db, passport.creatorId),
  ]);

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
            <ListRow label="No points yet" detail="Points arrive as you reach milestones and verify your work." />
          )}
        </ListGroup>

        <ListGroup
          id="tasks"
          label="Tasks"
          footer="Set by the CreatorCo team. The partnerships team marks a task done once they've checked it; each is earned once."
        >
          {tasks.length ? (
            tasks.map((t) => (
              <ListRow
                key={t.id}
                label={t.title}
                detail={`${POINTS_TASK_CATEGORY_LABELS[t.category]} · ${t.description}`}
                value={t.completedAt ? undefined : formatPoints(t.points)}
                accessory={t.completedAt ? <StatusBadge tone="success">Done</StatusBadge> : undefined}
              />
            ))
          ) : (
            <ListRow label="No tasks right now" detail="New tasks appear here when the team adds them." />
          )}
        </ListGroup>

        {EARN_GUIDE.map((g) => (
          <ListGroup key={g.key} id={`earn-${g.key}`} label={`How you earn: ${g.label}`} footer={g.footer}>
            {g.rows.map((r) => (
              <ListRow key={r.label} label={r.label} detail={r.frequency} value={formatPoints(r.points)} />
            ))}
          </ListGroup>
        ))}

        <ul className="flex list-disc flex-col gap-1 pl-5 text-footnote text-ink-subtle">
          {POINTS_TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </CreatorShell>
  );
}
