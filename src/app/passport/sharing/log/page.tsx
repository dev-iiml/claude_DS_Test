import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { listAccessLog } from "@/modules/public-passport/codes-service";

import { requireMember } from "../../../_lib/member";
import { CreatorShell } from "../../../_components/creator-shell";

export const metadata: Metadata = { title: "Access log" };

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const when = (day: string, hour: number) =>
  `${dayFmt.format(new Date(`${day}T00:00:00Z`))}, ${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00 IST`;

/** Who unlocked the passport. Names and companies typed by code holders are unverified; brand entries are verified organisations. */
export default async function AccessLogPage() {
  const { user } = await requireMember();
  const log = await listAccessLog(getDb(), user.userId);
  return (
    <CreatorShell>
      <BackLink href="/passport/sharing" label="Sharing" />
      <PageHeader title="Access log" description="Every unlock of your Passport. Kept until you close your account." />
      <div className="max-w-2xl">
        <ListGroup
          id="access-log"
          label="Unlocks"
          footer="Names and companies entered with a code are as typed — CreatorCo hasn't checked them. Brand entries are organisations CreatorCo has verified."
        >
          {log.length ? (
            log.map((l) => (
              <ListRow
                key={l.id}
                label={
                  l.kind === "brand"
                    ? (l.orgName ?? "A verified organisation")
                    : l.kind === "lockout"
                      ? "Several wrong codes were tried on your page"
                      : [l.viewerName, l.viewerCompany].filter(Boolean).join(", ") || "Someone with a code"
                }
                detail={`${l.kind === "code" && l.codeLabel ? `Code “${l.codeLabel}” · ` : ""}${when(l.day, l.hour)}`}
                accessory={
                  l.kind === "brand" ? (
                    <StatusBadge tone="success">Verified brand</StatusBadge>
                  ) : l.kind === "lockout" ? (
                    <StatusBadge tone="warning">Alert</StatusBadge>
                  ) : (
                    <StatusBadge>Code</StatusBadge>
                  )
                }
              />
            ))
          ) : (
            <ListRow label="No unlocks yet" />
          )}
        </ListGroup>
      </div>
    </CreatorShell>
  );
}
