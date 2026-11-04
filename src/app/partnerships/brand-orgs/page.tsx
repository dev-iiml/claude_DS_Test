import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { ORG_TYPE_LABELS } from "@/modules/brand-orgs/domain";
import { listOpenClaims, listOrgs, ORG_QUEUE_FILTERS, type OrgQueueFilter } from "@/modules/brand-orgs/review-service";
import { requirePartnershipsAdmin } from "@/modules/identity";

import { PartnershipsShell } from "../../_components/creator-shell";
import { ORG_STATUS } from "./present";

export const metadata: Metadata = { title: "Brand organisations" };

const FILTER_LABELS: Record<OrgQueueFilter, string> = {
  to_verify: "To check",
  to_approve: "To approve",
  pending_actions: "Suspend / reinstate",
  verified: "Verified",
  suspended: "Suspended",
  rejected: "Rejected",
};

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export default async function BrandOrgsPage({ searchParams }: PageProps<"/partnerships/brand-orgs">) {
  const staff = await requirePartnershipsAdmin();
  const q = await searchParams;
  const filter = (ORG_QUEUE_FILTERS as readonly string[]).includes(String(q.f)) ? (q.f as OrgQueueFilter) : "to_verify";
  const db = getDb();
  const [orgs, claims] = await Promise.all([listOrgs(db, filter), listOpenClaims(db)]);
  return (
    <PartnershipsShell role={staff.role}>
      <PageHeader
        title="Brand organisations"
        description="Check brands and agencies before they can unlock creator Passports. One admin checks, a different admin approves — for verification, claims, logos, suspension and reinstatement."
      />
      <nav aria-label="Queues" className="mb-6 flex flex-wrap gap-2">
        {ORG_QUEUE_FILTERS.map((f) => (
          <Link
            key={f}
            href={`/partnerships/brand-orgs?f=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className="rounded-full px-3 py-1.5 text-subhead ring-1 ring-line ring-inset aria-[current=page]:bg-ink aria-[current=page]:text-paper"
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <ListGroup id="orgs" label={FILTER_LABELS[filter]}>
          {orgs.length ? (
            orgs.map((o) => (
              <ListRow
                key={o.id}
                href={`/partnerships/brand-orgs/${o.id}`}
                label={o.legalName}
                detail={`${ORG_TYPE_LABELS[o.orgType]} · @${o.emailDomain} · signed up ${day.format(o.createdAt)}${o.verifiedBy === staff.userId && o.status === "pending" ? " · you checked it — another admin approves" : ""}${o.openClaims ? ` · ${o.openClaims} claim/logo to review` : ""}`}
                accessory={<StatusBadge tone={ORG_STATUS[o.status].tone}>{ORG_STATUS[o.status].label}</StatusBadge>}
              />
            ))
          ) : (
            <ListRow label="Nothing here" />
          )}
        </ListGroup>
        <ListGroup id="claims" label="Claims and logos to review">
          {claims.length ? (
            claims.map((c) => (
              <ListRow
                key={c.id}
                href={`/partnerships/brand-orgs/${c.orgId}#claims`}
                label={c.brandName}
                detail={`${c.orgName} · claim ${c.status}${c.logoStatus ? ` · logo ${c.logoStatus}` : ""}`}
              />
            ))
          ) : (
            <ListRow label="Nothing to review" />
          )}
        </ListGroup>
      </div>
    </PartnershipsShell>
  );
}
