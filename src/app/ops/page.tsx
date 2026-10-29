import type { Metadata } from "next";
import Link from "next/link";

import { ListGroup, ListRow, MetricBlock, PageHeader, StatusBadge } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { requireOpsAdmin } from "@/modules/identity";
import { countPendingChanges, getIntegrationsOverview } from "@/modules/integrations";
import { countJobsByStatus } from "@/modules/jobs";

import { OpsShell } from "../_components/creator-shell";
import { clientIp } from "../_lib/rate-limit";

import { runHealthChecksAction } from "./actions";
import { kindStatus } from "./_lib/present";

export const metadata: Metadata = { title: "Integrations" };

export default async function OpsPage({ searchParams }: PageProps<"/ops">) {
  const user = await requireOpsAdmin();
  const q = await searchParams;
  const db = getDb();
  const env = getServerEnv();
  const [kinds, pending, jobs] = await Promise.all([
    getIntegrationsOverview(db, { production: env.APP_ENV === "production" }),
    countPendingChanges(db),
    countJobsByStatus(db),
  ]);
  const degraded = kinds.filter((k) => kindStatus(k).tone !== "success").length;
  // Deployment check (Stage 17): the address rate limits count for THIS request (the viewer's own), so ops can
  // confirm CLIENT_IP_HEADER / CLIENT_IP_TRUSTED_HOPS match the hosting edge.
  const seenIp = await clientIp();

  return (
    <OpsShell role={user.role}>
      <PageHeader
        eyebrow={`Internal · ${env.APP_ENV}`}
        title="Integrations"
        description="Which provider serves each capability, how it's doing, and the switches to change it. Secrets live in the hosting secret store — never here."
        action={
          <form action={runHealthChecksAction}>
            <SubmitButton variant="secondary" size="sm" pendingLabel="Checking…">
              Check health now
            </SubmitButton>
          </form>
        }
      />

      {q.notice === "checked" ? (
        <Alert tone="success" className="mb-6">
          Health checks recorded.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Capabilities", value: kinds.length },
          { label: "Needing attention", value: degraded },
          { label: "Awaiting approval", value: pending },
          { label: "Dead jobs", value: jobs.dead ?? 0 },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <MetricBlock label={m.label} value={m.value} />
            </CardContent>
          </Card>
        ))}
      </div>

      {pending > 0 ? (
        <Alert tone="warning" className="mt-6">
          {pending} change{pending === 1 ? "" : "s"} awaiting a second approver. <Link href="/ops/changes">Review</Link>
        </Alert>
      ) : null}

      <ListGroup
        id="capabilities"
        label="Capabilities"
        className="mt-8"
        footer="Calls fail over to the fallback only while the primary's circuit is open; a failed call is never retried on another provider."
      >
        {kinds.map((k) => {
          const status = kindStatus(k);
          const serving = k.configs.find((c) => c.key === k.serving);
          const failures = k.configs.reduce((n, c) => n + c.calls24h.failures, 0);
          return (
            <ListRow
              key={k.kind}
              href={`/ops/providers/${k.kind}`}
              label={k.label}
              detail={[
                serving ? `${serving.key} · ${serving.mode}` : "No config serving",
                k.configs.find((c) => c.role === "fallback") ? "fallback ready" : "no fallback",
                failures ? `${failures} failed call${failures === 1 ? "" : "s"} today` : null,
                k.pendingChanges ? `${k.pendingChanges} pending` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              accessory={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
            />
          );
        })}
      </ListGroup>

      <ListGroup
        id="request-diagnostics"
        label="Rate-limit client address"
        className="mt-8"
        footer={`Should match your own public IP address (IPv6 is shown per /64). If it shows the hosting edge's address or "not found", fix CLIENT_IP_HEADER / CLIENT_IP_TRUSTED_HOPS (currently ${env.CLIENT_IP_HEADER}, ${env.CLIENT_IP_TRUSTED_HOPS} hops) — see docs/DEPLOYMENT.md.`}
      >
        <ListRow label="Your address, as the rate limiter sees it" value={seenIp ?? "not found"} />
      </ListGroup>
    </OpsShell>
  );
}
