import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { getDb } from "@/db";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { REPORT_REASONS } from "@/modules/public-passport/domain";
import { passportForStaff } from "@/modules/public-passport/moderation-service";
import { staffLockedView } from "@/modules/public-passport/page-service";

import { PartnershipsShell } from "../../../_components/creator-shell";
import { PassportRender } from "../../../p/_components/passport-render";
import { decideTakedownAction, handleReportAction, takeOfflineAction } from "../actions";

export const metadata: Metadata = { title: "Public passport" };

const REASON = Object.fromEntries(REPORT_REASONS) as Record<string, string>;
const NOTICE: Record<string, string> = {
  offline: "The page is offline. Propose a permanent takedown or lift it after review.",
  propose_permanent: "Permanent takedown proposed. A different admin approves.",
  approve_permanent: "Takedown is permanent.",
  lift: "Takedown lifted. The page is back if the creator still publishes it.",
  report_dismissed: "Report dismissed.",
  report_actioned: "Report marked as actioned.",
};
const day = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export default async function PassportDeskPage({ params, searchParams }: PageProps<"/partnerships/passports/[id]">) {
  const staff = await requirePartnershipsAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const data = await passportForStaff(db, id);
  if (!data) notFound();
  const view = await staffLockedView(db, id);
  const q = await searchParams;
  const notice = typeof q.notice === "string" ? NOTICE[q.notice] : undefined;
  const error =
    typeof q.notice === "string" && q.notice.startsWith("error_")
      ? q.notice === "error_four_eyes"
        ? "A different admin has to approve a permanent takedown."
        : "That didn't work — reload and check its state."
      : undefined;
  const active = data.takedowns.find(
    (t) => t.status === "offline" || t.status === "permanent_proposed" || t.status === "permanent",
  );

  return (
    <PartnershipsShell role={staff.role}>
      <BackLink href="/partnerships/passports" label="Public passports" />
      <PageHeader
        title={data.passport.slug ? `/p/${data.passport.slug}` : "Public passport"}
        description={`Creator: ${data.passport.displayName}`}
        action={
          active ? <StatusBadge tone="danger">Offline</StatusBadge> : <StatusBadge>{data.passport.status}</StatusBadge>
        }
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
        <div className="flex flex-col gap-8">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {active ? (
            <section aria-labelledby="takedown-heading" className="flex flex-col gap-3">
              <h2 id="takedown-heading" className="text-title-3 font-semibold tracking-tight">
                Takedown · {active.status.replace("_", " ")}
              </h2>
              <p className="text-subhead text-ink-muted">
                {REASON[active.reason] ?? active.reason} · since {day.format(active.createdAt)}
              </p>
              <div className="flex flex-wrap gap-3">
                {active.status === "offline" ? (
                  <TakedownButton
                    passportId={id}
                    takedownId={active.id}
                    step="propose_permanent"
                    label="Propose permanent"
                  />
                ) : null}
                {active.status === "permanent_proposed" ? (
                  active.proposedBy === staff.userId ? (
                    <p className="text-subhead text-ink-muted">You proposed this. A different admin approves.</p>
                  ) : (
                    <TakedownButton
                      passportId={id}
                      takedownId={active.id}
                      step="approve_permanent"
                      label="Approve permanent"
                      destructive
                    />
                  )
                ) : null}
                {active.status !== "permanent" ? (
                  <TakedownButton passportId={id} takedownId={active.id} step="lift" label="Lift takedown" />
                ) : null}
              </div>
            </section>
          ) : (
            <form action={takeOfflineAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="passportId" value={id} />
              <NativeSelect name="reason" defaultValue="" aria-label="Reason" className="sm:max-w-xs">
                <option value="" disabled>
                  Reason
                </option>
                {REPORT_REASONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" variant="destructive">
                Take offline now
              </Button>
            </form>
          )}

          <ListGroup id="reports" label="Reports" footer="Reports hold a reason code only — never who sent them.">
            {data.reports.length ? (
              data.reports.map((r) => (
                <li key={r.id} className="flex min-h-row items-center justify-between gap-3 px-4 py-2.5">
                  <span>
                    <span className="block text-body">{REASON[r.reason] ?? r.reason}</span>
                    <span className="text-footnote text-ink-muted">
                      {day.format(r.createdAt)} · {r.status}
                    </span>
                  </span>
                  {r.status === "open" ? (
                    <span className="flex gap-2">
                      {(["dismissed", "actioned"] as const).map((o) => (
                        <form key={o} action={handleReportAction}>
                          <input type="hidden" name="passportId" value={id} />
                          <input type="hidden" name="reportId" value={r.id} />
                          <input type="hidden" name="outcome" value={o} />
                          <Button type="submit" size="sm" variant="secondary">
                            {o === "dismissed" ? "Dismiss" : "Actioned"}
                          </Button>
                        </form>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))
            ) : (
              <ListRow label="No reports" />
            )}
          </ListGroup>
        </div>

        <section aria-labelledby="stranger-heading" className="flex flex-col gap-3">
          <h2 id="stranger-heading" className="text-headline font-semibold">
            What a stranger sees
          </h2>
          {view ? (
            <div className="rounded-lg bg-paper p-5 ring-1 ring-line ring-inset">
              <PassportRender view={view} photoSrc={null} logoBase={null} />
            </div>
          ) : (
            <p className="text-subhead text-ink-muted">Not published by the creator — nothing to show.</p>
          )}
          <p className="text-footnote text-ink-muted">The locked tier only. There is no staff unlock.</p>
        </section>
      </div>
    </PartnershipsShell>
  );
}

function TakedownButton({
  passportId,
  takedownId,
  step,
  label,
  destructive,
}: {
  passportId: string;
  takedownId: string;
  step: string;
  label: string;
  destructive?: boolean;
}) {
  return (
    <form action={decideTakedownAction}>
      <input type="hidden" name="passportId" value={passportId} />
      <input type="hidden" name="takedownId" value={takedownId} />
      <input type="hidden" name="step" value={step} />
      <Button type="submit" variant={destructive ? "destructive" : "secondary"}>
        {label}
      </Button>
    </form>
  );
}
