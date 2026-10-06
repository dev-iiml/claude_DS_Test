import type { Metadata } from "next";

import { EmptyState, ListGroup, ListRow, MetricBlock, PageHeader, StatusBadge } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireAdmin } from "@/modules/identity";
import { getAdminOverview } from "@/modules/risk-console/admin-overview";
import { getIntegrationsOverview } from "@/modules/integrations";

import { AdminShell } from "../_components/creator-shell";

export const metadata: Metadata = { title: "Risk console" };

const GST_LABELS: Record<string, string> = {
  not_registered: "Not registered",
  registered: "Registered",
  unknown_requires_review: "Requires review",
  not_declared: "Not yet declared",
};

const HEALTH_TONE = { ok: "success", degraded: "warning", down: "danger", unknown: "neutral" } as const;

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default async function AdminPage() {
  const admin = await requireAdmin();
  const overview = await getAdminOverview(getDb());
  // Read-only summary; changes happen in the integration control plane (/ops).
  const integrations = await getIntegrationsOverview(getDb(), { production: process.env.APP_ENV === "production" });

  return (
    <AdminShell role={admin.role}>
      <PageHeader
        eyebrow={`Internal · ${admin.role === "super_admin" ? "Super admin" : "Risk admin"}`}
        title="Risk console"
        description="Aggregates only. Applications, underwriting comparison and simulated partner decisions arrive in a later stage."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Creator accounts", value: overview.creatorAccounts },
          { label: "Profiles completed", value: overview.profilesCompleted },
          { label: "Onboarding", value: overview.profilesInDraft },
          { label: "Connected accounts", value: overview.connectedAccounts },
          { label: "Graph runs", value: overview.graphRuns },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <MetricBlock label={m.label} value={m.value} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ListGroup id="providers" label="Providers" footer="Managed by ops in the integration control plane.">
          {integrations.map((k) => {
            const serving = k.configs.find((c) => c.key === k.serving);
            return (
              <ListRow
                key={k.kind}
                label={k.label}
                detail={serving ? `${serving.key} · ${serving.mode}` : k.route?.paused ? "Paused" : "Unavailable"}
                accessory={
                  serving ? (
                    <StatusBadge tone={HEALTH_TONE[serving.health]}>{serving.health}</StatusBadge>
                  ) : (
                    <StatusBadge tone="danger">off</StatusBadge>
                  )
                }
              />
            );
          })}
        </ListGroup>

        <div className="flex flex-col gap-8">
          <ListGroup
            id="calls"
            label="Provider calls · last 24 hours"
            footer="Operation outcomes only — payloads are never stored."
          >
            {overview.providerCalls.length === 0 ? (
              <li className="p-4">
                <EmptyState title="No provider calls" className="bg-transparent p-0" />
              </li>
            ) : (
              overview.providerCalls.map((c) => (
                <ListRow
                  key={`${c.kind}-${c.key}-${c.outcome}`}
                  label={c.kind}
                  detail={`${c.key} · ${c.outcome}`}
                  value={<span className="tabular-nums">{c.n}</span>}
                />
              ))
            )}
          </ListGroup>

          <ListGroup
            id="gst"
            label="GST declarations"
            footer="Self-declared by creators unless checked against the registry."
          >
            {overview.gstBreakdown.map((row) => (
              <ListRow
                key={row.gstStatus}
                label={GST_LABELS[row.gstStatus] ?? row.gstStatus}
                value={<span className="tabular-nums">{row.n}</span>}
              />
            ))}
          </ListGroup>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ListGroup
          id="applications"
          label="Eligibility checks"
          footer="Counts by status. Financial inputs are not shown here."
        >
          {overview.applications.length === 0 ? (
            <ListRow label="No checks yet" />
          ) : (
            overview.applications.map((a) => (
              <ListRow
                key={a.status}
                label={<span className="font-mono text-[14px]">{a.status}</span>}
                value={<span className="tabular-nums">{a.n}</span>}
              />
            ))
          )}
        </ListGroup>
        <ListGroup
          id="consents"
          label="Consents"
          footer={`Receipts per purpose. ${overview.profilesPaused} membership(s) paused.`}
        >
          {overview.consents.map((c) => (
            <ListRow
              key={c.key}
              label={<span className="font-mono text-[14px]">{c.key}</span>}
              value={<span className="tabular-nums">{`${c.granted} on · ${c.withdrawn} withdrawn`}</span>}
            />
          ))}
        </ListGroup>
        <ListGroup id="erasures" label="Erasure requests" footer="Deferred requests wait for a retention hold to lift.">
          {overview.erasures.length === 0 ? (
            <ListRow label="No erasure requests" />
          ) : (
            overview.erasures.map((e) => (
              <ListRow
                key={`${e.scope}-${e.status}`}
                label={<span className="font-mono text-[14px]">{e.scope}</span>}
                detail={e.status}
                value={<span className="tabular-nums">{e.n}</span>}
              />
            ))
          )}
        </ListGroup>
      </div>

      <ListGroup
        id="audit"
        label="Recent audit events"
        footer="Event types only — metadata is not displayed here."
        className="mt-8"
      >
        {overview.recentEvents.length === 0 ? (
          <li className="p-4">
            <EmptyState title="No audit events yet" className="bg-transparent p-0" />
          </li>
        ) : (
          overview.recentEvents.map((ev) => (
            <ListRow
              key={ev.id}
              label={<span className="font-mono text-[14px]">{ev.eventType}</span>}
              detail={<time dateTime={ev.createdAt.toISOString()}>{utc(ev.createdAt)}</time>}
            />
          ))
        )}
      </ListGroup>
    </AdminShell>
  );
}
