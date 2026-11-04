import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { formatPoints } from "@/modules/rewards/rules";
import { POINTS_TASK_CATEGORY_LABELS } from "@/modules/rewards/tasks-domain";
import { listTasksForStaff } from "@/modules/rewards/tasks-service";

import { PartnershipsShell } from "../../_components/creator-shell";
import { TASK_STATUS } from "./present";
import { ProposeTaskForm } from "./forms";

export const metadata: Metadata = { title: "Points tasks" };

export default async function TasksPage() {
  const staff = await requirePartnershipsAdmin();
  const tasks = await listTasksForStaff(getDb());
  return (
    <PartnershipsShell role={staff.role}>
      <PageHeader
        title="Points tasks"
        description="Tasks creators can complete for Creator Points. One admin proposes, another approves; you mark completions after checking them."
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
        <ListGroup id="tasks" label="All tasks">
          {tasks.length ? (
            tasks.map((t) => (
              <ListRow
                key={t.id}
                href={`/partnerships/tasks/${t.id}`}
                label={t.title}
                detail={`${POINTS_TASK_CATEGORY_LABELS[t.category]} · ${formatPoints(t.points)} · ${t.completions} completed${t.status === "proposed" && t.proposedBy === staff.userId ? " · waiting for another admin" : ""}`}
                accessory={<StatusBadge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</StatusBadge>}
              />
            ))
          ) : (
            <ListRow label="No tasks yet" detail="Propose the first one." />
          )}
        </ListGroup>
        <section aria-labelledby="propose-heading" className="flex flex-col gap-4">
          <h2 id="propose-heading" className="text-title-3 font-semibold tracking-tight">
            Propose a task
          </h2>
          <ProposeTaskForm />
        </section>
      </div>
    </PartnershipsShell>
  );
}
