import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { requireOpsAdmin } from "@/modules/identity";
import { JOB_SCHEDULES, lastRunByType, listRecentJobs } from "@/modules/jobs";

import { OpsShell } from "../../_components/creator-shell";
import { retryJobAction, runJobNowAction } from "../actions";
import { utc } from "../_lib/present";

export const metadata: Metadata = { title: "Jobs" };

const STATUS_TONE = { queued: "info", running: "warning", succeeded: "success", dead: "danger" } as const;
const NOTICE: Record<string, string> = {
  ran: "Job run.",
  retried: "Job queued again.",
  unchanged: "That job wasn't dead, so nothing changed.",
};

export default async function JobsPage({ searchParams }: PageProps<"/ops/jobs">) {
  const user = await requireOpsAdmin();
  const q = await searchParams;
  const db = getDb();
  const [recent, last] = await Promise.all([listRecentJobs(db), lastRunByType(db)]);
  const cronConfigured = Boolean(getServerEnv().CRON_SECRET);
  const scheduleLabel = new Map(JOB_SCHEDULES.map((s) => [s.type, s.label]));

  return (
    <OpsShell role={user.role}>
      <PageHeader
        title="Jobs"
        description="Scheduled sweeps that keep data retention and provider health on track. Jobs carry identifiers and counts only."
      />
      {typeof q.notice === "string" && NOTICE[q.notice] ? (
        <Alert tone="success" className="mb-6">
          {NOTICE[q.notice]}
        </Alert>
      ) : null}
      {!cronConfigured ? (
        <Alert tone="warning" className="mb-6">
          No scheduler is configured (CRON_SECRET is unset), so schedules only run from this page or with{" "}
          <code>npm run jobs:tick</code>.
        </Alert>
      ) : null}

      <ListGroup id="schedules" label="Schedules">
        {JOB_SCHEDULES.map((s) => {
          const run = last.get(s.type);
          return (
            <ListRow
              key={s.type}
              label={s.label}
              detail={`${s.description} Every ${s.everyMinutes} min${run ? ` · last ${run.status} ${utc(new Date(run.finished_at ?? run.created_at))}` : " · never run"}`}
              accessory={
                <form action={runJobNowAction}>
                  <input type="hidden" name="type" value={s.type} />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Running…">
                    Run now
                  </SubmitButton>
                </form>
              }
            />
          );
        })}
      </ListGroup>

      <ListGroup
        id="recent"
        label="Recent jobs"
        className="mt-8"
        footer="Failed attempts retry with backoff; after the last attempt a job is dead until retried."
      >
        {recent.length === 0 ? (
          <ListRow label="No jobs yet" />
        ) : (
          recent.map((j) => (
            <ListRow
              key={j.id}
              label={scheduleLabel.get(j.type) ?? j.type}
              detail={[
                utc(j.createdAt),
                `attempt ${j.attempts}/${j.maxAttempts}`,
                j.result
                  ? Object.entries(j.result)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(", ")
                  : null,
                j.lastError,
              ]
                .filter(Boolean)
                .join(" · ")}
              accessory={
                <span className="flex items-center gap-2">
                  {j.status === "dead" ? (
                    <form action={retryJobAction}>
                      <input type="hidden" name="jobId" value={j.id} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Retrying…">
                        Retry
                      </SubmitButton>
                    </form>
                  ) : null}
                  <StatusBadge tone={STATUS_TONE[j.status]}>{j.status}</StatusBadge>
                </span>
              }
            />
          ))
        )}
      </ListGroup>
    </OpsShell>
  );
}
