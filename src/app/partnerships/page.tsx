import type { Metadata } from "next";

import {
  CreatorStatusBadge,
  EmptyState,
  ListGroup,
  ListRow,
  MetricBlock,
  PageHeader,
  StatusBadge,
} from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { listOpportunitiesForStaff, listRequestsForStaff } from "@/modules/access";
import { ACCESS_REQUEST_STATUS_LABELS } from "@/modules/access/presentation";
import { STATUS_CRITERION_LABELS, criterionRequirement } from "@/modules/creator-status/presentation";
import { EMPTY_STATUS_INPUTS, STATUS_RULES_VERSION, evaluateStatus } from "@/modules/creator-status/rules";
import { CREATOR_STATUS_LABELS } from "@/modules/creator-status/status";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { formatPoints } from "@/modules/rewards/rules";

import { PartnershipsShell } from "../_components/creator-shell";

import { REQUEST_TONE, istDateTime } from "./_lib/present";

export const metadata: Metadata = { title: "Partnerships" };

export default async function PartnershipsPage() {
  const staff = await requirePartnershipsAdmin();
  const db = getDb();
  const [pending, recent, opportunities] = await Promise.all([
    listRequestsForStaff(db, { status: "requested" }),
    listRequestsForStaff(db, { limit: 20 }),
    listOpportunitiesForStaff(db),
  ]);
  const decided = recent.filter((r) => r.status !== "requested");
  const live = opportunities.filter((o) => o.status === "live");
  const rules = evaluateStatus(EMPTY_STATUS_INPUTS).criteria;

  return (
    <PartnershipsShell role={staff.role}>
      <PageHeader
        eyebrow={`Internal · ${getServerEnv().APP_ENV}`}
        title="Access requests"
        description="Creators requesting brand opportunities. Preview: brands are samples and nothing is sent to them. You see the creator-professional summary the brand opportunities consent covers — never financial data."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: "Awaiting review", value: pending.length },
          { label: "Live opportunities", value: live.length },
          { label: "Places approved", value: live.reduce((s, o) => s + o.approved, 0) },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <MetricBlock label={m.label} value={m.value} />
            </CardContent>
          </Card>
        ))}
      </div>

      <ListGroup
        id="queue"
        label="Awaiting review"
        className="mt-8"
        footer="Oldest first. Points stay held until you decide."
      >
        {pending.length ? (
          pending.map((r) => (
            <ListRow
              key={r.id}
              href={`/partnerships/requests/${r.id}`}
              label={`${r.displayName} · ${r.opportunityTitle}`}
              detail={`${r.brandName} · ${formatPoints(r.pointsHeld)} held · ${istDateTime.format(r.requestedAt)}`}
              accessory={<CreatorStatusBadge tier={r.tierAtRequest} />}
            />
          ))
        ) : (
          <ListRow label="Nothing waiting" detail="New requests appear here." />
        )}
      </ListGroup>

      {decided.length ? (
        <ListGroup id="recent" label="Recently closed" className="mt-8">
          {decided.map((r) => (
            <ListRow
              key={r.id}
              href={`/partnerships/requests/${r.id}`}
              label={`${r.displayName} · ${r.opportunityTitle}`}
              detail={r.brandName}
              accessory={
                <StatusBadge tone={REQUEST_TONE[r.status]}>{ACCESS_REQUEST_STATUS_LABELS[r.status]}</StatusBadge>
              }
            />
          ))}
        </ListGroup>
      ) : null}

      {opportunities.length === 0 ? (
        <EmptyState className="mt-8" title="No opportunities yet" description="Create one under Opportunities." />
      ) : null}

      <ListGroup
        id="status-rules"
        label={`Creator Status rules (${STATUS_RULES_VERSION})`}
        className="mt-8"
        footer="Membership tiers from Professional Graph signals. Read-only here; never a credit input."
      >
        {(["onyx", "icon"] as const).map((tier) => (
          <ListRow
            key={tier}
            label={CREATOR_STATUS_LABELS[tier]}
            detail={rules
              .filter((c) => c.tier === tier)
              .map((c) => `${STATUS_CRITERION_LABELS[c.key]}: ${criterionRequirement(c)}`)
              .join(" · ")}
          />
        ))}
      </ListGroup>
    </PartnershipsShell>
  );
}
