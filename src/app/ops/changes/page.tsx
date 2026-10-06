import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { requireOpsAdmin } from "@/modules/identity";
import { PROVIDER_KIND_LABELS, configKeys, expireStaleChanges, listChangeRequests } from "@/modules/integrations";
import { pendingPartnerApprovals } from "@/modules/partners";

import { OpsShell } from "../../_components/creator-shell";
import { DecisionForm } from "../_components/forms";
import { ACTION_LABEL, STATUS_TONE, describeChange, utc } from "../_lib/present";

export const metadata: Metadata = { title: "Approvals" };

const NOTICE: Record<string, { tone: "success" | "neutral"; text: string }> = {
  approved: { tone: "success", text: "Approved and applied." },
  rejected: { tone: "neutral", text: "Rejected. Nothing changed." },
  cancelled: { tone: "neutral", text: "Your request was cancelled." },
  expired: { tone: "neutral", text: "That request had expired. Raise it again if it's still needed." },
};

export default async function ChangesPage({ searchParams }: PageProps<"/ops/changes">) {
  const user = await requireOpsAdmin();
  const q = await searchParams;
  const db = getDb();
  await expireStaleChanges({ db });
  const [pending, history, partnerPending] = await Promise.all([
    listChangeRequests(db, { pending: true }),
    listChangeRequests(db, { pending: false, limit: 30 }),
    pendingPartnerApprovals(db),
  ]);
  const partnerItems = [
    ...partnerPending.keys.map((k) => ({
      id: k.id,
      partnerId: k.partnerId,
      label: `API key “${k.label}” · ${k.partner}`,
      detail: `${k.prefix}… · issued ${utc(k.proposedAt)}`,
      own: k.proposedBy === user.userId,
    })),
    ...partnerPending.endpoints.map((e) => ({
      id: e.id,
      partnerId: e.partnerId,
      label: `Webhook URL · ${e.partner}`,
      detail: `${e.url} · proposed ${utc(e.proposedAt)}`,
      own: e.proposedBy === user.userId,
    })),
  ];
  const keys = await configKeys(
    db,
    [...pending, ...history]
      .flatMap((c) =>
        c.action === "set_route" ? [String(c.payload.primaryConfigId), String(c.payload.fallbackConfigId ?? "")] : [],
      )
      .filter(Boolean),
  );
  const notice = typeof q.notice === "string" ? NOTICE[q.notice] : undefined;

  return (
    <OpsShell role={user.role}>
      <PageHeader
        title="Approvals"
        description="Changes to live routing, sandbox/live configs and lifting a kill switch need a second ops admin. Requests expire after 48 hours."
      />
      {notice ? (
        <Alert tone={notice.tone} className="mb-6">
          {notice.text}
        </Alert>
      ) : null}

      {partnerItems.length ? (
        <ListGroup
          id="partner-approvals"
          label="Partner keys and webhook URLs"
          className="mb-8"
          footer="Approve or reject on the partner's page. Pending items can't be approved after 48 hours."
        >
          {partnerItems.map((i) => (
            <ListRow
              key={i.id}
              href={`/ops/partners/${i.partnerId}`}
              label={i.label}
              detail={i.detail}
              accessory={<StatusBadge tone="warning">{i.own ? "Yours" : "Review"}</StatusBadge>}
            />
          ))}
        </ListGroup>
      ) : null}

      <section aria-labelledby="pending-label" className="flex flex-col gap-3">
        <h2 id="pending-label" className="px-4 text-footnote font-semibold tracking-wide text-ink-subtle uppercase">
          Awaiting approval
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-lg bg-surface px-4 py-4 text-body text-ink-muted ring-1 ring-line ring-inset">
            Nothing to review.
          </p>
        ) : (
          pending.map((c) => (
            <article key={c.id} className="flex flex-col gap-4 rounded-lg bg-surface p-4 ring-1 ring-line ring-inset">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-semibold">
                    {ACTION_LABEL[c.action] ?? c.action} · {PROVIDER_KIND_LABELS[c.kind]}
                  </p>
                  <p className="mt-1 font-mono text-[14px] break-words text-ink-muted">{describeChange(c, keys)}</p>
                </div>
                <StatusBadge tone="warning">pending</StatusBadge>
              </div>
              <p className="text-subhead text-ink-muted">
                &ldquo;{c.reason}&rdquo; — {c.requestedByEmail ?? "unknown"}, {utc(c.requestedAt)}
                {c.expiresAt ? ` · expires ${utc(c.expiresAt)}` : ""}
              </p>
              <DecisionForm requestId={c.id} ownRequest={c.requestedBy === user.userId} />
            </article>
          ))
        )}
      </section>

      <ListGroup id="history" label="History" className="mt-8" footer="Decided requests are immutable.">
        {history.length === 0 ? (
          <ListRow label="No decisions yet" />
        ) : (
          history.map((c) => (
            <ListRow
              key={c.id}
              label={`${ACTION_LABEL[c.action] ?? c.action} · ${PROVIDER_KIND_LABELS[c.kind]}`}
              detail={[
                describeChange(c, keys),
                `requested by ${c.requestedByEmail ?? "unknown"}`,
                c.decidedByEmail ? `decided by ${c.decidedByEmail}` : c.approvalRequired ? null : "no approval needed",
                utc(c.decidedAt ?? c.requestedAt),
              ]
                .filter(Boolean)
                .join(" · ")}
              accessory={<StatusBadge tone={STATUS_TONE[c.status]}>{c.status}</StatusBadge>}
            />
          ))
        )}
      </ListGroup>
    </OpsShell>
  );
}
