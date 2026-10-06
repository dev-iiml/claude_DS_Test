import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader } from "@/components/creatorco";
import { getDb } from "@/db";
import { getConsentCentre } from "@/modules/privacy";

import { requireConsentCentreAccess } from "@/app/_lib/member";

import { ConsentFrame, PurposeStatusBadge } from "./_components";

export const metadata: Metadata = { title: "Consent centre" };

export default async function ConsentCentrePage() {
  const { user, paused } = await requireConsentCentreAccess();
  const purposes = await getConsentCentre(getDb(), user.userId);
  const core = purposes.filter((p) => p.policy.core);
  const optional = purposes.filter((p) => !p.policy.core);

  return (
    <ConsentFrame paused={paused}>
      {paused ? null : <BackLink href="/account" label="Account" />}
      <PageHeader
        title="Consent centre"
        description="Each consent covers one purpose. You can review the exact text, see your receipts, and withdraw at any time."
      />
      <div className="flex max-w-2xl flex-col gap-8">
        <ListGroup id="membership" label="Membership" footer="Needed to keep your Creator Professional Profile.">
          {core.map((p) => (
            <ListRow
              key={p.policy.key}
              href={`/account/consents/${p.policy.key}`}
              label={p.policy.label}
              detail={p.policy.summary}
              accessory={<PurposeStatusBadge status={p.status} />}
            />
          ))}
        </ListGroup>
        <ListGroup id="optional" label="Optional" footer="Turning these off never affects your membership.">
          {optional.map((p) => (
            <ListRow
              key={p.policy.key}
              href={`/account/consents/${p.policy.key}`}
              label={p.policy.label}
              detail={p.policy.summary}
              accessory={<PurposeStatusBadge status={p.status} />}
            />
          ))}
        </ListGroup>
        <p className="px-1 text-[13px] leading-snug text-ink-subtle">
          Financial eligibility and sharing with a partner lender will each have their own consent when they arrive.
          Sharing anything with a partner lender will always need its own consent.
        </p>
      </div>
    </ConsentFrame>
  );
}
