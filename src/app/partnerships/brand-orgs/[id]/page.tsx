import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { getDb } from "@/db";
import { orgDailyQuota } from "@/modules/brand-orgs/access-service";
import { IDENTIFIER_LABELS, ORG_REASONS, ORG_TYPE_LABELS } from "@/modules/brand-orgs/domain";
import { getOrgForReview } from "@/modules/brand-orgs/review-service";
import { requirePartnershipsAdmin } from "@/modules/identity";
import { platformLimit } from "@/modules/integrations/change-service";

import { PartnershipsShell } from "../../../_components/creator-shell";
import {
  approveOrgAction,
  decideClaimAction,
  decideOrgActionAction,
  linkBrandAction,
  lookupAction,
  proposeOrgActionAction,
  rejectOrgAction,
  setQuotaAction,
  verifyOrgAction,
} from "../actions";
import { ORG_STATUS } from "../present";

export const metadata: Metadata = { title: "Brand organisation" };

const NOTICE: Record<string, string> = {
  looked_up: "Company register checked.",
  verified: "Checked. A different admin now approves.",
  approved: "Organisation verified.",
  rejected: "Organisation rejected.",
  proposed_suspend: "Suspension proposed. A different admin approves.",
  proposed_reinstate: "Reinstatement proposed. A different admin approves.",
  action_approved: "Done.",
  action_rejected: "Proposal declined.",
  quota: "Daily quota saved.",
  linked: "Access brand link saved.",
  claim_verify: "Claim checked. A different admin approves.",
  claim_approve: "Claim approved.",
  claim_reject: "Claim rejected.",
  logo_verify: "Logo checked. A different admin approves.",
  logo_approve: "Logo approved. It now shows on Passports.",
  logo_reject: "Logo rejected.",
};

const ERROR: Record<string, string> = {
  error_four_eyes: "A different admin has to do this step.",
  error_invalid: "Check the form — a reason may be missing.",
  error_wrong_state: "This has already moved on. Reload to see where it is.",
  error_not_verified: "Verify the organisation first.",
  error_unavailable: "The company register didn't respond. Try again.",
};

const Reasons = () => (
  <NativeSelect name="reason" defaultValue="" aria-label="Reason" className="sm:max-w-xs">
    <option value="" disabled>
      Reason
    </option>
    {ORG_REASONS.map(([v, l]) => (
      <option key={v} value={v}>
        {l}
      </option>
    ))}
  </NativeSelect>
);

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export default async function BrandOrgPage({ params, searchParams }: PageProps<"/partnerships/brand-orgs/[id]">) {
  const staff = await requirePartnershipsAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const r = await getOrgForReview(db, id);
  if (!r) notFound();
  const q = await searchParams;
  const o = r.org;
  const [limit, quota] = await Promise.all([platformLimit(db, "brand_unlock_daily_quota"), orgDailyQuota(db, o.id)]);
  const notice = typeof q.notice === "string" ? NOTICE[q.notice] : undefined;
  const error =
    typeof q.notice === "string"
      ? (ERROR[q.notice] ?? (q.notice.startsWith("error_") ? "That didn't work." : undefined))
      : undefined;
  const linked = r.accessBrands.find((b) => b.brandOrgId === o.id);

  return (
    <PartnershipsShell role={staff.role}>
      <BackLink href="/partnerships/brand-orgs" label="Brand organisations" />
      <PageHeader
        eyebrow={ORG_TYPE_LABELS[o.orgType]}
        title={o.legalName}
        action={<StatusBadge tone={ORG_STATUS[o.status].tone}>{ORG_STATUS[o.status].label}</StatusBadge>}
      />
      <div className="flex max-w-3xl flex-col gap-8">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <ListGroup
          id="details"
          label="What they told us"
          footer="Organisation data only. The GSTIN itself is never stored — only whether one was given and its state code."
        >
          <ListRow label="Legal name" value={o.legalName} />
          <ListRow label="Website" value={o.website} />
          <ListRow
            label="Email domain"
            value={`@${o.emailDomain}`}
            detail={r.domainMatchesWebsite ? "Matches the website" : "Doesn't match the website"}
          />
          <ListRow label={IDENTIFIER_LABELS[o.identifierType]} value={o.identifierValue} />
          <ListRow
            label="GSTIN"
            value={o.gstinGiven ? `Given${o.gstinStateCode ? ` · state ${o.gstinStateCode}` : ""}` : "Not given"}
          />
          <ListRow label="Signed up" value={dateTime.format(o.createdAt)} />
        </ListGroup>

        <ListGroup
          id="lookup"
          label="Company register"
          action={
            <form action={lookupAction}>
              <input type="hidden" name="orgId" value={o.id} />
              <Button type="submit" size="sm" variant="secondary">
                {r.lookup ? "Check again" : "Check"}
              </Button>
            </form>
          }
        >
          {r.lookup ? (
            <>
              <ListRow
                label="Registered name"
                value={r.lookup.legalName ?? "Not found"}
                detail={r.lookup.nameMatches ? "Matches" : "Doesn't match"}
              />
              <ListRow label="Status" value={r.lookup.status ?? "—"} />
              <ListRow label="Incorporated" value={r.lookup.incorporatedOn ?? "—"} />
              <ListRow label="Checked" value={dateTime.format(r.lookup.at)} />
            </>
          ) : (
            <ListRow label="Not checked yet" detail="Check the register before verifying." />
          )}
        </ListGroup>

        {o.status === "pending" ? (
          <section aria-labelledby="decide-heading" className="flex flex-col gap-3">
            <h2 id="decide-heading" className="text-title-3 font-semibold tracking-tight">
              Decision
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              {!o.verifiedBy ? (
                <form action={verifyOrgAction}>
                  <input type="hidden" name="orgId" value={o.id} />
                  <Button type="submit" disabled={!r.lookup}>
                    Mark as checked
                  </Button>
                </form>
              ) : o.verifiedBy === staff.userId ? (
                <p className="text-subhead text-ink-muted">You checked this. A different admin approves.</p>
              ) : (
                <form action={approveOrgAction}>
                  <input type="hidden" name="orgId" value={o.id} />
                  <Button type="submit">Approve — verify organisation</Button>
                </form>
              )}
            </div>
            <form action={rejectOrgAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="orgId" value={o.id} />
              <Reasons />
              <Button type="submit" variant="destructive">
                Reject
              </Button>
            </form>
          </section>
        ) : null}

        {o.status === "verified" || o.status === "suspended" ? (
          <section aria-labelledby="access-heading" className="flex flex-col gap-3">
            <h2 id="access-heading" className="text-title-3 font-semibold tracking-tight">
              {o.status === "verified" ? "Suspend" : "Reinstate"}
            </h2>
            {o.pendingAction ? (
              o.pendingBy === staff.userId ? (
                <p className="text-subhead text-ink-muted">
                  You proposed to {o.pendingAction} this organisation. A different admin decides.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {(["approve", "decline"] as const).map((d) => (
                    <form key={d} action={decideOrgActionAction}>
                      <input type="hidden" name="orgId" value={o.id} />
                      <input type="hidden" name="decision" value={d} />
                      <Button type="submit" variant={d === "approve" ? "destructive" : "secondary"}>
                        {d === "approve" ? `Approve: ${o.pendingAction}` : "Decline"}
                      </Button>
                    </form>
                  ))}
                </div>
              )
            ) : (
              <form action={proposeOrgActionAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="orgId" value={o.id} />
                <input type="hidden" name="action" value={o.status === "verified" ? "suspend" : "reinstate"} />
                <Reasons />
                <Button type="submit" variant={o.status === "verified" ? "destructive" : "secondary"}>
                  Propose {o.status === "verified" ? "suspension" : "reinstatement"}
                </Button>
              </form>
            )}
          </section>
        ) : null}

        {o.status === "verified" ? (
          <>
            <form action={setQuotaAction} className="flex flex-col gap-2">
              <input type="hidden" name="orgId" value={o.id} />
              <label htmlFor="quota" className="text-subhead font-medium">
                Daily unlock quota{" "}
                <span className="font-normal text-ink-subtle">
                  now {quota}; empty uses the /ops limit ({limit})
                </span>
              </label>
              <div className="flex gap-3">
                <Input
                  id="quota"
                  name="quota"
                  inputMode="numeric"
                  defaultValue={o.dailyUnlockQuota ?? ""}
                  className="max-w-32"
                />
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </div>
            </form>
            <form action={linkBrandAction} className="flex flex-col gap-2">
              <input type="hidden" name="orgId" value={o.id} />
              <label htmlFor="brandId" className="text-subhead font-medium">
                Access brand{" "}
                <span className="font-normal text-ink-subtle">
                  creators who request its opportunities can share a code with this organisation
                </span>
              </label>
              <div className="flex gap-3">
                <NativeSelect id="brandId" name="brandId" defaultValue={linked?.id ?? ""} className="sm:max-w-xs">
                  <option value="">Not linked</option>
                  {r.accessBrands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </div>
            </form>
          </>
        ) : null}

        <section id="claims" aria-labelledby="claims-heading" className="flex flex-col gap-3">
          <h2 id="claims-heading" className="text-title-3 font-semibold tracking-tight">
            Brand claims and logos
          </h2>
          {r.claims.length ? (
            r.claims.map((c) => (
              <div key={c.id} className="flex flex-col gap-3 rounded-lg bg-surface p-4 ring-1 ring-line ring-inset">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-body font-medium">{c.brandName}</p>
                  <StatusBadge>{`claim ${c.status}`}</StatusBadge>
                </div>
                <ClaimSteps
                  orgId={o.id}
                  claimId={c.id}
                  target="claim"
                  status={c.status}
                  verifiedBy={c.verifiedBy}
                  staffId={staff.userId}
                />
                {c.logoStatus ? (
                  <div className="flex flex-col gap-3 border-t border-line pt-3">
                    <div className="flex items-center gap-4">
                      {c.logoScan === "clean" ? (
                        // eslint-disable-next-line @next/next/no-img-element -- served by our own guarded, audited route
                        <img
                          src={`/partnerships/brand-orgs/claims/${c.id}/logo`}
                          alt={`Uploaded logo for ${c.brandName}`}
                          width={56}
                          height={56}
                          className="size-14 rounded-md object-contain ring-1 ring-line"
                        />
                      ) : null}
                      <p className="text-subhead text-ink-muted">
                        Logo {c.logoStatus} · scan {c.logoScan ?? "—"} · licence confirmed by the uploader
                      </p>
                    </div>
                    <ClaimSteps
                      orgId={o.id}
                      claimId={c.id}
                      target="logo"
                      status={c.logoStatus}
                      verifiedBy={c.logoVerifiedBy}
                      staffId={staff.userId}
                    />
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-subhead text-ink-muted">No claims.</p>
          )}
        </section>

        <ListGroup id="members" label="Members">
          {r.members.map((m) => (
            <ListRow key={m.email} label={m.email} detail={`${m.orgRole} · ${m.status}`} />
          ))}
        </ListGroup>

        <ListGroup
          id="unlocks"
          label="Unlocks"
          footer="Counts per passport and day only — creator content is never shown here."
        >
          {r.unlocks.length ? (
            r.unlocks
              .slice(0, 30)
              .map((u) => (
                <ListRow
                  key={`${u.passportId}-${u.day}`}
                  label={`Passport ${u.passportId.slice(0, 8)}`}
                  value={u.day}
                />
              ))
          ) : (
            <ListRow label="No unlocks" />
          )}
        </ListGroup>

        <ListGroup id="history" label="Review history">
          {r.reviews.length ? (
            r.reviews.map((v) => (
              <ListRow
                key={v.id}
                label={`${v.target} · ${v.action.replaceAll("_", " ")}`}
                detail={`${v.actorEmail ?? "staff"}${v.reasonCode ? ` · ${v.reasonCode.replaceAll("_", " ")}` : ""}`}
                value={dateTime.format(v.createdAt)}
              />
            ))
          ) : (
            <ListRow label="No decisions yet" />
          )}
        </ListGroup>
      </div>
    </PartnershipsShell>
  );
}

function ClaimSteps({
  orgId,
  claimId,
  target,
  status,
  verifiedBy,
  staffId,
}: {
  orgId: string;
  claimId: string;
  target: "claim" | "logo";
  status: string;
  verifiedBy: string | null;
  staffId: string;
}) {
  if (status !== "pending" && status !== "verified") return null;
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="target" value={target} />
    </>
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "pending" ? (
        <form action={decideClaimAction}>
          {hidden}
          <input type="hidden" name="step" value="verify" />
          <Button type="submit" size="sm" variant="secondary">
            Mark {target} as checked
          </Button>
        </form>
      ) : verifiedBy === staffId ? (
        <p className="text-footnote text-ink-muted">You checked this {target}. A different admin approves.</p>
      ) : (
        <form action={decideClaimAction}>
          {hidden}
          <input type="hidden" name="step" value="approve" />
          <Button type="submit" size="sm">
            Approve {target}
          </Button>
        </form>
      )}
      <form action={decideClaimAction} className="flex flex-wrap items-center gap-2">
        {hidden}
        <input type="hidden" name="step" value="reject" />
        <Reasons />
        <Button type="submit" size="sm" variant="destructive">
          Reject {target}
        </Button>
      </form>
    </div>
  );
}
