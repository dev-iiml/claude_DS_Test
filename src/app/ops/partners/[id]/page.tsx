import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { requireOpsAdmin } from "@/modules/identity";
import { getPartnerDetail, pendingExpired } from "@/modules/partners";

import { OpsShell } from "../../../_components/creator-shell";
import { utc } from "../../_lib/present";
import { pingAction, redeliverAction } from "../actions";
import { DecideForm, EndpointActions, IssueKeyForm, PartnerStatusForm, RevokeKeyForm, WebhookForm } from "../forms";

export const metadata: Metadata = { title: "Partner" };

const KEY_TONE = {
  cancelled: "neutral",
  pending: "warning",
  active: "success",
  revoked: "danger",
  rejected: "neutral",
  expired: "neutral",
} as const;
const DELIVERY_TONE = { pending: "info", delivered: "success", dead: "danger" } as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="px-1 text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function PartnerPage({ params, searchParams }: PageProps<"/ops/partners/[id]">) {
  const user = await requireOpsAdmin();
  const { id } = await params;
  const q = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getPartnerDetail(getDb(), id);
  if (!detail) notFound();
  const { partner: p, keys, endpoints, deliveries } = detail;
  const now = new Date();
  const active = endpoints.find((e) => e.status === "active") ?? null;
  const pending = endpoints.find((e) => e.status === "pending") ?? null;
  const usableKeys = keys.filter((k) => k.status === "active" && k.expiresAt > now);

  return (
    <OpsShell role={user.role}>
      <BackLink href="/ops/partners" label="Partners" />
      <PageHeader
        eyebrow={`${p.key} · ${p.environment} · lender config ${p.lenderKey}`}
        title={p.name}
        description="API keys, the webhook URL and recent deliveries. Keys and URLs need a second ops admin; revoking and suspending apply at once."
      />
      {q.notice === "pinged" ? (
        <Alert tone="success" className="mb-6">
          Test event queued and a delivery attempted — see Recent deliveries.
        </Alert>
      ) : null}
      {p.status === "suspended" ? (
        <Alert tone="danger" className="mb-6">
          Suspended: every key is blocked and webhooks are paused.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-10">
          <ListGroup
            id="keys"
            label="API keys"
            footer="Only a hash of each key is stored. The prefix is recorded with every decision posted with it."
          >
            {keys.length === 0 ? (
              <ListRow label="No keys yet" />
            ) : (
              keys.map((k) => {
                const expired = k.status === "active" && k.expiresAt <= now;
                const stale = k.status === "pending" && pendingExpired(k.proposedAt, now);
                return (
                  <ListRow
                    key={k.id}
                    label={
                      <span className="flex flex-col">
                        <span>{k.label}</span>
                        <span className="font-mono text-[13px] text-ink-muted">{k.prefix}…</span>
                      </span>
                    }
                    detail={
                      <span className="flex flex-col gap-2">
                        <span>
                          {[
                            k.scopes.join(", "),
                            `issued by ${k.proposedByEmail ?? "seed"} ${utc(k.proposedAt)}`,
                            k.decidedByEmail
                              ? `${k.status === "rejected" ? "rejected" : "approved"} by ${k.decidedByEmail}`
                              : null,
                            k.status === "active" ? `expires ${utc(k.expiresAt)}` : null,
                            k.lastUsedAt
                              ? `last used ${utc(k.lastUsedAt)}`
                              : k.status === "active"
                                ? "never used"
                                : null,
                            k.revokedByEmail ? `revoked by ${k.revokedByEmail}: “${k.revokeReason}”` : null,
                            k.replacesKeyId ? "rotation" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {k.status === "pending" && !stale ? (
                          <DecideForm kind="key" partnerId={p.id} id={k.id} own={k.proposedBy === user.userId} />
                        ) : null}
                        {k.status === "active" && !expired ? (
                          <RevokeKeyForm partnerId={p.id} keyId={k.id} label={k.label} />
                        ) : null}
                      </span>
                    }
                    accessory={
                      <StatusBadge tone={expired || stale ? "neutral" : KEY_TONE[k.status]}>
                        {expired ? "expired" : stale ? "approval expired" : k.status}
                      </StatusBadge>
                    }
                  />
                );
              })
            )}
          </ListGroup>

          {p.status === "active" ? (
            <Section id="issue-key" title="Issue a key">
              <IssueKeyForm
                partnerId={p.id}
                activeKeys={usableKeys.map((k) => ({ id: k.id, label: k.label, prefix: k.prefix }))}
              />
            </Section>
          ) : null}

          <Section id="partner-status" title="Partner status">
            <PartnerStatusForm partnerId={p.id} status={p.status} />
          </Section>
        </div>

        <div className="flex flex-col gap-10">
          <ListGroup
            id="webhook"
            label="Webhook"
            footer="Events: proposal.submitted, decision.queried, decision.query_withdrawn, decision.confirmed, ping. Signed with HMAC-SHA256 (CreatorCo-Signature: t=…,v1=…). The partner can also read GET /api/partner/v1/events."
          >
            {active ? (
              <ListRow
                label={<span className="font-mono text-[13px] break-all">{active.url}</span>}
                detail={
                  <span className="flex flex-col gap-3">
                    <span>
                      {[
                        `approved by ${active.decidedByEmail ?? "seed"}`,
                        `secret v${active.secretVersion}`,
                        active.previousSecretUntil && active.previousSecretUntil > now
                          ? `v${active.previousSecretVersion} also sent until ${utc(active.previousSecretUntil)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <EndpointActions partnerId={p.id} endpointId={active.id} />
                  </span>
                }
                accessory={<StatusBadge tone="success">Active</StatusBadge>}
              />
            ) : (
              <ListRow label="No active webhook URL" detail="Events still appear in the partner's feed." />
            )}
            {pending ? (
              <ListRow
                label={<span className="font-mono text-[13px] break-all">{pending.url}</span>}
                detail={
                  <span className="flex flex-col gap-2">
                    <span>
                      proposed by {pending.proposedByEmail ?? "staff"} {utc(pending.proposedAt)}
                    </span>
                    {pendingExpired(pending.proposedAt, now) ? (
                      <span>Approval window passed — propose it again.</span>
                    ) : (
                      <DecideForm
                        kind="webhook"
                        partnerId={p.id}
                        id={pending.id}
                        own={pending.proposedBy === user.userId}
                      />
                    )}
                  </span>
                }
                accessory={<StatusBadge tone="warning">Awaiting approval</StatusBadge>}
              />
            ) : null}
          </ListGroup>

          {p.status === "active" ? (
            // Always mounted, so the one-time signing secret stays visible after the URL turns pending.
            <Section id="propose-webhook" title={active ? "Change the webhook URL" : "Set a webhook URL"}>
              <WebhookForm partnerId={p.id} hasActive={Boolean(active)} locked={Boolean(pending)} />
            </Section>
          ) : null}

          <ListGroup
            id="deliveries"
            label="Recent deliveries"
            action={
              active && p.status === "active" ? (
                <form action={pingAction}>
                  <input type="hidden" name="partnerId" value={p.id} />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                    Send test event
                  </SubmitButton>
                </form>
              ) : null
            }
            footer="Retried with backoff (8 attempts over about 4 hours). Only the HTTP status is kept — never a body."
          >
            {deliveries.length === 0 ? (
              <ListRow label="No deliveries yet" />
            ) : (
              deliveries.map((d) => (
                <ListRow
                  key={d.id}
                  label={<span className="font-mono text-[13px]">{d.eventType}</span>}
                  detail={[
                    `#${d.eventSeq} · ${utc(d.createdAt)}`,
                    `attempt ${d.attempts}`,
                    d.lastHttpStatus ? `HTTP ${d.lastHttpStatus}` : null,
                    d.lastError,
                    d.status === "pending" && d.nextAttemptAt ? `next ${utc(d.nextAttemptAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  accessory={
                    <span className="flex items-center gap-2">
                      {d.status === "dead" && active ? (
                        <form action={redeliverAction}>
                          <input type="hidden" name="partnerId" value={p.id} />
                          <input type="hidden" name="deliveryId" value={d.id} />
                          <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                            Send again
                          </SubmitButton>
                        </form>
                      ) : null}
                      <StatusBadge tone={DELIVERY_TONE[d.status]}>{d.status}</StatusBadge>
                    </span>
                  }
                />
              ))
            )}
          </ListGroup>
        </div>
      </div>
    </OpsShell>
  );
}
