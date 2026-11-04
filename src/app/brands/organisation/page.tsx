import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db";
import { listOrgClaims, searchDirectoryForClaim } from "@/modules/brand-orgs/claims-service";
import { IDENTIFIER_LABELS, ORG_TYPE_LABELS } from "@/modules/brand-orgs/domain";
import { getOrgProfile, listInvites, listMembers } from "@/modules/brand-orgs/org-service";
import { requireBrandMember } from "@/modules/identity";

import { BrandShell } from "../../_components/creator-shell";
import { removeMemberAction, requestClaimAction, revokeInviteAction } from "../actions";
import { InviteForm } from "../forms";

export const metadata: Metadata = { title: "Organisation" };

const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  removed: { tone: "success", text: "Member removed. Their account can no longer sign in." },
  remove_failed: { tone: "danger", text: "We couldn't remove that member." },
  invite_revoked: { tone: "success", text: "Invitation cancelled." },
  claimed: { tone: "success", text: "Claim sent. CreatorCo checks every claim before it counts." },
  claim_exists: { tone: "danger", text: "You've already claimed this brand." },
  claim_failed: { tone: "danger", text: "We couldn't send that claim." },
  logo: { tone: "success", text: "Logo uploaded. It appears on Passports once CreatorCo approves it." },
  logo_rejected: { tone: "danger", text: "Upload a PNG or JPEG up to 1 MB that passes our checks." },
  logo_licence: { tone: "danger", text: "Confirm you own or are authorised to use this logo." },
  logo_failed: { tone: "danger", text: "We couldn't upload that logo." },
  logo_paused: { tone: "danger", text: "Uploads are paused right now. Please try again later." },
  rate_limited: { tone: "danger", text: "You've uploaded several logos recently. Please try again later." },
};

const CLAIM_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Being checked", tone: "warning" },
  verified: { label: "Being checked", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Not approved", tone: "danger" },
};

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export default async function OrganisationPage({ searchParams }: PageProps<"/brands/organisation">) {
  const user = await requireBrandMember();
  const m = user.membership;
  const q = await searchParams;
  const db = getDb();
  const owner = m.orgRole === "owner";
  const canClaim = owner && m.orgStatus === "verified";
  const term = typeof q.q === "string" ? q.q.slice(0, 60) : "";
  const [org, members, invites, claims, matches] = await Promise.all([
    getOrgProfile(db, m.orgId),
    listMembers(db, m.orgId),
    owner ? listInvites(db, m.orgId) : Promise.resolve([]),
    listOrgClaims(db, m.orgId),
    canClaim && term ? searchDirectoryForClaim(db, term) : Promise.resolve([]),
  ]);
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;

  return (
    <BrandShell>
      <BackLink href="/brands" label="Home" />
      <PageHeader title="Organisation" description={m.orgName} />
      <div className="flex max-w-2xl flex-col gap-8">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

        {org ? (
          <ListGroup
            id="details"
            label="Details"
            footer="To change these, contact CreatorCo — your organisation is checked again."
          >
            <ListRow label="Legal name" value={org.legalName} />
            <ListRow label="Type" value={ORG_TYPE_LABELS[org.orgType]} />
            <ListRow label="Website" value={org.website} />
            <ListRow label={IDENTIFIER_LABELS[org.identifierType]} value={org.identifierValue} />
            <ListRow label="GSTIN" value={org.gstinGiven ? "Given" : "Not given"} />
            <ListRow label="Email domain" value={`@${org.emailDomain}`} />
          </ListGroup>
        ) : null}

        <ListGroup id="members" label="Members">
          {members.map((x) => (
            <li key={x.id} className="flex min-h-row items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-body">{x.email}</span>
                <span className="text-footnote text-ink-muted">{x.orgRole === "owner" ? "Owner" : "Member"}</span>
              </span>
              {owner && x.userId !== user.userId ? (
                <form action={removeMemberAction}>
                  <input type="hidden" name="memberId" value={x.id} />
                  <Button type="submit" size="sm" variant="destructive" aria-label={`Remove ${x.email}`}>
                    Remove
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="flex min-h-row items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-body">{i.email}</span>
                <span className="text-footnote text-ink-muted">Invited · expires {day.format(i.expiresAt)}</span>
              </span>
              <form action={revokeInviteAction}>
                <input type="hidden" name="inviteId" value={i.id} />
                <Button type="submit" size="sm" variant="ghost" aria-label={`Cancel invitation for ${i.email}`}>
                  Cancel
                </Button>
              </form>
            </li>
          ))}
        </ListGroup>

        {owner ? (
          <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
            <h2 id="invite-heading" className="text-title-3 font-semibold tracking-tight">
              Invite a colleague
            </h2>
            <InviteForm />
          </section>
        ) : null}

        <section id="claims" aria-labelledby="claims-heading" className="flex flex-col gap-4">
          <h2 id="claims-heading" className="text-title-3 font-semibold tracking-tight">
            Your brands
          </h2>
          <p className="text-subhead text-ink-muted">
            Claim the brands you own in CreatorCo&apos;s brand directory. Once approved, you can add your logo —
            creators&apos; Passports show it next to work with your brand. Without an approved logo, Passports show a
            plain initial.
          </p>
          <ListGroup id="claim-list" label="Claims">
            {claims.length ? (
              claims.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-body font-medium">{c.brandName}</span>
                    <StatusBadge tone={CLAIM_STATUS[c.status]!.tone}>{CLAIM_STATUS[c.status]!.label}</StatusBadge>
                  </div>
                  {c.logoStatus ? (
                    <p className="text-footnote text-ink-muted">
                      Logo:{" "}
                      {c.logoStatus === "approved"
                        ? "approved"
                        : c.logoStatus === "rejected"
                          ? "not approved"
                          : "being checked"}
                    </p>
                  ) : null}
                  {canClaim && c.status !== "rejected" ? (
                    <form
                      action={`/brands/organisation/claims/${c.id}/logo`}
                      method="post"
                      encType="multipart/form-data"
                      className="flex flex-col gap-3"
                    >
                      <label htmlFor={`logo-${c.id}`} className="text-subhead font-medium">
                        Logo <span className="font-normal text-ink-subtle">PNG or JPEG, up to 1 MB</span>
                      </label>
                      <input
                        id={`logo-${c.id}`}
                        name="file"
                        type="file"
                        accept="image/png,image/jpeg"
                        required
                        className="text-subhead"
                      />
                      <label className="flex items-start gap-2 text-subhead">
                        <input type="checkbox" name="licence" required className="mt-1" />
                        We own or are authorised to use this logo
                      </label>
                      <div>
                        <Button type="submit" size="sm" variant="secondary">
                          Upload logo
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              ))
            ) : (
              <ListRow label="No brands claimed yet" />
            )}
          </ListGroup>

          {canClaim ? (
            <div className="flex flex-col gap-3">
              <form method="get" className="flex gap-2" role="search">
                <label htmlFor="q" className="sr-only">
                  Search the brand directory
                </label>
                <Input id="q" name="q" defaultValue={term} placeholder="Search the brand directory" />
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              </form>
              {term ? (
                <ListGroup id="matches" label="Directory matches">
                  {matches.length ? (
                    matches.map((d) => (
                      <li key={d.id} className="flex min-h-row items-center justify-between gap-3 px-4 py-2.5">
                        <span>{d.name}</span>
                        <form action={requestClaimAction}>
                          <input type="hidden" name="directoryId" value={d.id} />
                          <Button type="submit" size="sm" variant="secondary" aria-label={`Claim ${d.name}`}>
                            Claim
                          </Button>
                        </form>
                      </li>
                    ))
                  ) : (
                    <ListRow label="No matches" />
                  )}
                </ListGroup>
              ) : null}
            </div>
          ) : !owner ? (
            <p className="text-footnote text-ink-muted">Only an owner can claim brands.</p>
          ) : (
            <p className="text-footnote text-ink-muted">You can claim brands once your organisation is verified.</p>
          )}
        </section>
      </div>
    </BrandShell>
  );
}
