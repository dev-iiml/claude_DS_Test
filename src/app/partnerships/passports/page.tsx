import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { REPORT_REASONS } from "@/modules/public-passport/domain";
import { listReports, listTakedowns } from "@/modules/public-passport/moderation-service";
import { requirePartnershipsAdmin } from "@/modules/identity";

import { PartnershipsShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Public passports" };

const REASON = Object.fromEntries(REPORT_REASONS) as Record<string, string>;
const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export default async function PassportsDeskPage() {
  const staff = await requirePartnershipsAdmin();
  const db = getDb();
  const [reports, takedowns] = await Promise.all([listReports(db, "open"), listTakedowns(db)]);
  return (
    <PartnershipsShell role={staff.role}>
      <PageHeader
        title="Public passports"
        description="Reports from the public and takedowns. You can take a page offline at once; making it permanent needs a second admin. You only ever see the stranger's view."
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
        <ListGroup id="reports" label="Open reports">
          {reports.length ? (
            reports.map((r) => (
              <ListRow
                key={r.id}
                href={`/partnerships/passports/${r.passportId}`}
                label={r.slug ? `/p/${r.slug}` : `Passport ${r.passportId.slice(0, 8)}`}
                detail={`${REASON[r.reason] ?? r.reason} · ${day.format(r.createdAt)}`}
              />
            ))
          ) : (
            <ListRow label="No open reports" />
          )}
        </ListGroup>
        <ListGroup id="takedowns" label="Takedowns">
          {takedowns.length ? (
            takedowns.map(({ t, slug }) => (
              <ListRow
                key={t.id}
                href={`/partnerships/passports/${t.passportId}`}
                label={slug ? `/p/${slug}` : `Passport ${t.passportId.slice(0, 8)}`}
                detail={`${REASON[t.reason] ?? t.reason} · ${day.format(t.createdAt)}`}
                accessory={
                  <StatusBadge tone={t.status === "permanent" ? "danger" : "warning"}>
                    {t.status.replace("_", " ")}
                  </StatusBadge>
                }
              />
            ))
          ) : (
            <ListRow label="No takedowns" />
          )}
        </ListGroup>
      </div>
    </PartnershipsShell>
  );
}
