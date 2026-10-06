import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { requireOpsAdmin } from "@/modules/identity";
import { listPartners } from "@/modules/partners";

import { OpsShell } from "../../_components/creator-shell";
import { CreatePartnerForm } from "./forms";

export const metadata: Metadata = { title: "Partners" };

export default async function PartnersPage() {
  const user = await requireOpsAdmin();
  const partners = await listPartners(getDb());
  return (
    <OpsShell role={user.role}>
      <PageHeader
        title="Partners"
        description="Partner lenders on the partner API. They fetch the proposals sent to them with an API key and post their decisions back; CreatorCo sends signed webhooks that carry ids only."
      />
      <ListGroup id="partners" label="Partners">
        {partners.length === 0 ? (
          <ListRow label="No partners yet" />
        ) : (
          partners.map((p) => (
            <ListRow
              key={p.id}
              href={`/ops/partners/${p.id}`}
              label={p.name}
              detail={[
                `${p.key} · lender config ${p.lenderKey}`,
                `${p.activeKeys} active key${p.activeKeys === 1 ? "" : "s"}`,
                p.pendingKeys ? `${p.pendingKeys} awaiting approval` : null,
                p.webhook === "active"
                  ? "webhook on"
                  : p.webhook === "pending"
                    ? "webhook awaiting approval"
                    : "no webhook",
              ]
                .filter(Boolean)
                .join(" · ")}
              accessory={
                <span className="flex items-center gap-2">
                  <StatusBadge tone={p.environment === "live" ? "brand" : "info"}>{p.environment}</StatusBadge>
                  {p.status === "suspended" ? <StatusBadge tone="danger">Suspended</StatusBadge> : null}
                </span>
              }
            />
          ))
        )}
      </ListGroup>
      <section aria-labelledby="add-partner" className="mt-10 flex max-w-2xl flex-col gap-4">
        <h2 id="add-partner" className="px-1 text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
          Add a partner
        </h2>
        <CreatePartnerForm />
      </section>
    </OpsShell>
  );
}
