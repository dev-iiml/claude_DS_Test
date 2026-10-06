import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { requireOpsAdmin } from "@/modules/identity";
import { configKeys, getIntegrationsOverview, listChangeRequests } from "@/modules/integrations";
import { adaptersFor } from "@/providers/catalog";
import { PROVIDER_KINDS, type ProviderKind } from "@/providers/types";

import { OpsShell } from "../../../_components/creator-shell";
import { ConfigForm, KillSwitchForm, RouteForm } from "../../_components/forms";
import {
  ACTION_LABEL,
  CIRCUIT_LABEL,
  HEALTH_TONE,
  MODE_TONE,
  STATUS_TONE,
  UNAVAILABLE_COPY,
  circuitTone,
  describeChange,
  kindStatus,
  utc,
} from "../../_lib/present";

export const metadata: Metadata = { title: "Provider" };

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg bg-surface ring-1 ring-line ring-inset">
      <summary className="flex min-h-row cursor-pointer list-none items-center justify-between px-4 text-body font-medium [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronRight aria-hidden="true" className="size-5 text-ink-subtle transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}

export default async function ProviderPage({ params, searchParams }: PageProps<"/ops/providers/[kind]">) {
  const user = await requireOpsAdmin();
  const { kind: rawKind } = await params;
  if (!(PROVIDER_KINDS as readonly string[]).includes(rawKind)) notFound();
  const kind = rawKind as ProviderKind;
  const q = await searchParams;
  const db = getDb();
  const [overview, pending, history] = await Promise.all([
    getIntegrationsOverview(db, { production: getServerEnv().APP_ENV === "production" }),
    listChangeRequests(db, { pending: true, kind, limit: 20 }),
    listChangeRequests(db, { pending: false, kind, limit: 10 }),
  ]);
  const k = overview.find((o) => o.kind === kind)!;
  const status = kindStatus(k);
  const primary = k.configs.find((c) => c.role === "primary");
  const fallback = k.configs.find((c) => c.role === "fallback");
  const adapters = adaptersFor(kind).map((a) => ({
    adapter: a.adapter,
    label: a.label,
    modes: a.modes,
    secrets: a.secrets,
  }));
  const keys = await configKeys(
    db,
    [...pending, ...history]
      .flatMap((c) =>
        c.action === "set_route" ? [String(c.payload.primaryConfigId), String(c.payload.fallbackConfigId ?? "")] : [],
      )
      .filter(Boolean),
  );

  return (
    <OpsShell role={user.role}>
      <BackLink href="/ops" label="Integrations" />
      <PageHeader
        eyebrow="Capability"
        title={k.label}
        description={
          k.selection.status === "unavailable"
            ? UNAVAILABLE_COPY[k.selection.reason]
            : k.serving
              ? `New calls go to “${k.serving}”.`
              : "No config is serving calls."
        }
        action={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      />

      {q.notice === "applied" ? (
        <Alert tone="success" className="mb-6">
          Change applied.
        </Alert>
      ) : q.notice === "pending" ? (
        <Alert tone="info" className="mb-6">
          Change requested. Another ops admin must approve it in <Link href="/ops/changes">Approvals</Link>.
        </Alert>
      ) : null}

      {k.route?.paused ? (
        <Alert tone="danger" className="mb-6" title="Kill switch engaged">
          All {k.label.toLowerCase()} calls are stopped{k.route.pausedAt ? ` since ${utc(k.route.pausedAt)}` : ""}.
          Reason: {k.route.pausedReason}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-8">
        <ListGroup id="route" label="Route">
          <ListRow label="Primary" value={primary ? `${primary.key} · ${primary.mode}` : "—"} />
          <ListRow label="Fallback" value={fallback ? `${fallback.key} · ${fallback.mode}` : "None"} />
        </ListGroup>

        <div className="flex flex-col gap-3">
          <Disclosure summary="Change route">
            <RouteForm
              kind={kind}
              configs={k.configs.map((c) => ({ id: c.id, key: c.key, mode: c.mode, enabled: c.enabled }))}
              primaryConfigId={primary?.id ?? null}
              fallbackConfigId={fallback?.id ?? null}
            />
          </Disclosure>
          {k.route ? (
            <Disclosure summary={k.route.paused ? "Lift the kill switch" : "Kill switch"}>
              <KillSwitchForm kind={kind} paused={k.route.paused} label={k.label.toLowerCase()} />
            </Disclosure>
          ) : null}
        </div>

        {k.configs.map((c) => (
          <section key={c.id} className="flex flex-col gap-3" aria-label={`Config ${c.key}`}>
            <ListGroup
              id={`config-${c.key}`}
              label={`${c.key}${c.role ? ` · ${c.role}` : ""}`}
              footer={`${c.adapterLabel} · version ${c.version}`}
            >
              <ListRow
                label="Mode"
                accessory={<StatusBadge tone={MODE_TONE[c.mode]}>{c.mode}</StatusBadge>}
                value={c.enabled ? "Enabled" : "Disabled"}
              />
              <ListRow
                label="Circuit"
                detail={
                  c.circuit === "closed"
                    ? c.consecutiveFailures
                      ? `${c.consecutiveFailures} recent failure${c.consecutiveFailures === 1 ? "" : "s"}`
                      : undefined
                    : c.openedAt
                      ? `Opened ${utc(c.openedAt)}`
                      : undefined
                }
                accessory={<StatusBadge tone={circuitTone(c.circuit)}>{CIRCUIT_LABEL[c.circuit]}</StatusBadge>}
              />
              <ListRow
                label="Health"
                detail={
                  c.healthCheckedAt
                    ? `${utc(c.healthCheckedAt)}${c.healthLatencyMs !== null ? ` · ${c.healthLatencyMs} ms` : ""}`
                    : "Not checked yet"
                }
                accessory={<StatusBadge tone={HEALTH_TONE[c.health]}>{c.health}</StatusBadge>}
              />
              <ListRow
                label="Calls · 24 hours"
                detail={c.calls24h.avgMs !== null ? `avg ${c.calls24h.avgMs} ms` : undefined}
                value={
                  <span className="tabular-nums">
                    {c.calls24h.successes} ok · {c.calls24h.failures} failed · {c.calls24h.rejections} rejected
                  </span>
                }
              />
              {c.secrets.length ? (
                c.secrets.map((s) => (
                  <ListRow
                    key={s.name}
                    label={<span className="font-mono text-[15px]">{s.name}</span>}
                    detail={s.envVar ?? "Not mapped"}
                    accessory={
                      <StatusBadge tone={s.present ? "success" : "danger"}>{s.present ? "set" : "missing"}</StatusBadge>
                    }
                  />
                ))
              ) : (
                <ListRow label="Secrets" value="None needed" />
              )}
              <ListRow
                label="Settings"
                value={<span className="font-mono text-[14px]">{JSON.stringify(c.settings)}</span>}
              />
              {c.misconfigured ? (
                <ListRow label={<span className="text-danger">Misconfigured — can&rsquo;t serve calls</span>} />
              ) : null}
            </ListGroup>
            <Disclosure summary={`Edit ${c.key}`}>
              <ConfigForm
                kind={kind}
                adapters={adapters}
                config={{
                  id: c.id,
                  key: c.key,
                  adapter: c.adapter,
                  mode: c.mode,
                  enabled: c.enabled,
                  settings: c.settings,
                  secretRefs: Object.fromEntries(c.secrets.filter((s) => s.envVar).map((s) => [s.name, s.envVar!])),
                  routed: c.role !== null,
                }}
              />
            </Disclosure>
          </section>
        ))}

        <Disclosure summary="Add a config">
          <ConfigForm kind={kind} adapters={adapters} />
        </Disclosure>

        <ListGroup id="changes" label="Changes" footer="Every change is kept with who requested and who decided it.">
          {[...pending, ...history].length === 0 ? (
            <ListRow label="No changes yet" />
          ) : (
            [...pending, ...history].map((c) => (
              <ListRow
                key={c.id}
                href={c.status === "pending" ? "/ops/changes" : undefined}
                label={ACTION_LABEL[c.action] ?? c.action}
                detail={`${describeChange(c, keys)} · ${c.requestedByEmail ?? "unknown"} · ${utc(c.requestedAt)}`}
                accessory={<StatusBadge tone={STATUS_TONE[c.status]}>{c.status}</StatusBadge>}
              />
            ))
          )}
        </ListGroup>
      </div>
    </OpsShell>
  );
}
