import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { listBrands, listOpportunitiesForStaff } from "@/modules/access";
import {
  OPPORTUNITY_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  tierRequirementLabel,
} from "@/modules/access/presentation";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { formatPoints } from "@/modules/rewards/rules";

import { PartnershipsShell } from "../../_components/creator-shell";
import { OPPORTUNITY_TONE, istDateTime, toIstLocal } from "../_lib/present";
import { OpportunityForm } from "../forms";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const staff = await requirePartnershipsAdmin();
  const db = getDb();
  const [rows, brands] = await Promise.all([listOpportunitiesForStaff(db), listBrands(db)]);
  const now = new Date();

  return (
    <PartnershipsShell role={staff.role}>
      <PageHeader
        title="Opportunities"
        description="Access opportunities from sample brands. Live ones are open to requests between their dates."
      />

      <ListGroup id="opportunities" label="All opportunities">
        {rows.map((o) => (
          <ListRow
            key={o.id}
            href={`/partnerships/opportunities/${o.id}`}
            label={`${o.title} · ${o.brandName}`}
            detail={`${OPPORTUNITY_KIND_LABELS[o.kind]} · ${tierRequirementLabel(o.minTier)} · ${formatPoints(o.pointsCost)} · ${o.approved}/${o.seats} approved · ${o.pending} pending · closes ${istDateTime.format(o.closesAt)}`}
            accessory={
              <StatusBadge tone={OPPORTUNITY_TONE[o.status]}>{OPPORTUNITY_STATUS_LABELS[o.status]}</StatusBadge>
            }
          />
        ))}
      </ListGroup>

      <section aria-labelledby="new-heading" className="mt-10 max-w-3xl">
        <h2 id="new-heading" className="mb-4 text-title-3 font-semibold tracking-tight">
          New opportunity
        </h2>
        <OpportunityForm
          brands={brands.map((b) => ({ id: b.id, name: b.name }))}
          initial={{
            brandId: "",
            title: "",
            kind: "pr_drop",
            category: "",
            summary: "",
            details: "",
            minTier: "member",
            pointsCost: "0",
            seats: "10",
            opensAt: toIstLocal(now),
            closesAt: toIstLocal(new Date(now.getTime() + 30 * 86_400_000)),
            status: "draft",
          }}
        />
      </section>
    </PartnershipsShell>
  );
}
