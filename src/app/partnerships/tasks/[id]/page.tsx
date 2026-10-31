import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { formatPoints } from "@/modules/rewards/rules";
import { POINTS_TASK_CATEGORY_LABELS } from "@/modules/rewards/tasks-domain";
import { listTasksForStaff } from "@/modules/rewards/tasks-service";

import { PartnershipsShell } from "../../../_components/creator-shell";
import { istDateTime } from "../../_lib/present";
import { CompleteTaskForm, DecideTaskForm, RetireTaskForm } from "../forms";
import { TASK_STATUS } from "../present";

export const metadata: Metadata = { title: "Points task" };

const NOTICES: Record<string, string> = {
  proposed: "Task proposed. Another partnerships admin needs to approve it before creators see it.",
  approved: "Approved. Creators can see the task now.",
  rejected: "Rejected. Creators never saw it.",
  retired: "Retired. Creators keep the points they earned.",
  completed: "Marked complete. The creator earned the task's points.",
};

export default async function TaskPage({ params, searchParams }: PageProps<"/partnerships/tasks/[id]">) {
  const staff = await requirePartnershipsAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const q = await searchParams;
  const task = (await listTasksForStaff(getDb())).find((t) => t.id === id);
  if (!task) notFound();
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;
  const mine = task.proposedBy === staff.userId;

  return (
    <PartnershipsShell role={staff.role}>
      <BackLink href="/partnerships/tasks" label="Points tasks" />
      <PageHeader
        eyebrow={`${POINTS_TASK_CATEGORY_LABELS[task.category]} · ${formatPoints(task.points)}`}
        title={task.title}
        description={task.description}
        action={<StatusBadge tone={TASK_STATUS[task.status].tone}>{TASK_STATUS[task.status].label}</StatusBadge>}
      />
      <div className="flex max-w-2xl flex-col gap-8">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <ListGroup id="task" label="Task">
          <ListRow label="Proposed" value={istDateTime.format(task.proposedAt)} detail={mine ? "By you" : undefined} />
          {task.decidedAt ? <ListRow label="Decided" value={istDateTime.format(task.decidedAt)} /> : null}
          <ListRow label="Completed by creators" value={String(task.completions)} />
        </ListGroup>

        {task.status === "proposed" ? (
          mine ? (
            <Alert tone="info">Another partnerships admin has to approve this task (four eyes).</Alert>
          ) : (
            <section aria-labelledby="decide-heading" className="flex flex-col gap-3">
              <h2 id="decide-heading" className="text-title-3 font-semibold tracking-tight">
                Review
              </h2>
              <p className="text-subhead text-ink-muted">
                Check it doesn&apos;t reward giving consent, sharing data, bank data or anything credit-related.
              </p>
              <DecideTaskForm taskId={task.id} />
            </section>
          )
        ) : null}

        {task.status === "active" ? (
          <>
            <section aria-labelledby="complete-heading" className="flex flex-col gap-3">
              <h2 id="complete-heading" className="text-title-3 font-semibold tracking-tight">
                Mark complete for a creator
              </h2>
              <CompleteTaskForm taskId={task.id} />
            </section>
            <section aria-labelledby="retire-heading" className="flex flex-col gap-3">
              <h2 id="retire-heading" className="text-title-3 font-semibold tracking-tight">
                Retire
              </h2>
              <RetireTaskForm taskId={task.id} />
            </section>
          </>
        ) : null}
      </div>
    </PartnershipsShell>
  );
}
