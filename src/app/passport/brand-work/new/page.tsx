import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/creatorco";
import { CONSENT_KEYS } from "@/modules/consent";

import { requireMember } from "../../../_lib/member";
import { CreatorShell } from "../../../_components/creator-shell";
import { istToday, pendingConsent } from "../_lib";
import { RecordForm } from "../record-form";

export const metadata: Metadata = { title: "Add brand work" };

export default async function NewBrandWorkPage() {
  const { user } = await requireMember();
  const definition = await pendingConsent(user.userId, CONSENT_KEYS.brandWorkRecords);
  return (
    <CreatorShell>
      <BackLink href="/passport/brand-work" label="Verified brand work" />
      <PageHeader title="Add brand work" description="Tell us about the collaboration. You'll add documents next." />
      <div className="max-w-2xl">
        <RecordForm definition={definition} today={istToday()} />
      </div>
    </CreatorShell>
  );
}
