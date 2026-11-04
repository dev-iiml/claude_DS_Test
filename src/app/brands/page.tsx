import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { orgDailyQuota, orgUnlocksToday } from "@/modules/brand-orgs/access-service";
import { BRAND_TERMS, ORG_TYPE_LABELS, type OrgStatus } from "@/modules/brand-orgs/domain";
import { requireBrandMember } from "@/modules/identity";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import { BrandShell } from "../_components/creator-shell";
import { acceptTermsAction } from "./actions";

export const metadata: Metadata = { title: "Brands" };

const STATUS: Record<OrgStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral"; text: string }> = {
  pending: {
    label: "Being checked",
    tone: "warning",
    text: "CreatorCo checks your organisation against the company register; two people on our team sign it off. You can unlock Passports once it's verified.",
  },
  verified: {
    label: "Verified",
    tone: "success",
    text: "Your organisation is verified. You can unlock Passports creators open to verified brands.",
  },
  rejected: {
    label: "Not verified",
    tone: "danger",
    text: "We couldn't verify your organisation. Contact CreatorCo if you think this is a mistake.",
  },
  suspended: {
    label: "Suspended",
    tone: "danger",
    text: "Your organisation's access is suspended. Contact CreatorCo.",
  },
};

export default async function BrandHomePage({ searchParams }: PageProps<"/brands">) {
  const user = await requireBrandMember();
  const m = user.membership;
  const q = await searchParams;
  const db = getDb();
  const status = STATUS[m.orgStatus];
  const verified = m.orgStatus === "verified";
  const [used, quota, discovery] = verified
    ? await Promise.all([
        orgUnlocksToday(db, m.orgId, new Date()),
        orgDailyQuota(db, m.orgId),
        isFeatureEnabled(db, "brand_discovery"),
      ])
    : [0, 0, false];

  return (
    <BrandShell>
      <PageHeader
        eyebrow={ORG_TYPE_LABELS[m.orgType]}
        title={m.orgName}
        description="Your organisation on CreatorCo."
      />
      <div className="flex max-w-2xl flex-col gap-8">
        {q.welcome ? <Alert tone="success">Your account is ready.</Alert> : null}
        {q.notice === "terms" ? <Alert tone="success">Thanks — you&apos;ve accepted the brand terms.</Alert> : null}

        <ListGroup id="status" label="Verification" footer={status.text}>
          <ListRow label="Organisation" accessory={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>} />
        </ListGroup>

        {!m.termsAccepted ? (
          <section aria-labelledby="terms-heading" className="flex flex-col gap-4">
            <h2 id="terms-heading" className="text-title-3 font-semibold tracking-tight">
              Brand terms
            </h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-subhead text-ink-muted">
              {BRAND_TERMS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <form action={acceptTermsAction}>
              <Button type="submit">Accept the brand terms</Button>
            </form>
          </section>
        ) : null}

        {verified && m.termsAccepted ? (
          <ListGroup
            id="unlocks"
            label="Today"
            footer="An unlock lasts for the rest of the day (India time). Re-opening a Passport you unlocked today doesn't count again."
          >
            <ListRow label="Passports unlocked today" value={`${used} of ${quota}`} />
            <ListRow href="/brands/unlocks" label="Unlock history" />
            {discovery ? (
              <ListRow
                href="/brands/discover"
                label="Discover creators"
                detail="Creators who chose to be found by verified brands"
              />
            ) : null}
          </ListGroup>
        ) : null}

        <p className="text-footnote text-ink-muted">
          Open a creator&apos;s Passport link to unlock it. Creators decide what verified brands can see, and every
          unlock appears in their access log with your organisation&apos;s name. Amounts are only ever shown as bands
          the creator chose to share.{" "}
          <Link href="/brands/organisation" className="text-gold underline-offset-2 hover:underline">
            Manage your organisation
          </Link>
        </p>
      </div>
    </BrandShell>
  );
}
