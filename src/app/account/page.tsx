import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { getAppearance } from "@/lib/appearance";
import { getConsentCentre } from "@/modules/privacy";
import { getMobileStatus } from "@/modules/creator-profile/queries";

import { requireMember } from "../_lib/member";
import { AppearanceControl } from "../_components/appearance-control";
import { CreatorShell } from "../_components/creator-shell";
import { SignOutForm } from "../_components/sign-out-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { user } = await requireMember();
  const db = getDb();
  const [appearance, mobile, consents] = await Promise.all([
    getAppearance(),
    getMobileStatus(db, user.userId),
    getConsentCentre(db, user.userId),
  ]);

  const onCount = consents.filter((c) => c.status === "on").length;

  return (
    <CreatorShell>
      <PageHeader title="Account" />
      <div className="flex max-w-2xl flex-col gap-8">
        <section aria-labelledby="appearance-label" className="flex flex-col gap-2">
          <h2
            id="appearance-label"
            className="px-4 text-footnote font-medium tracking-[0.02em] text-ink-subtle uppercase"
          >
            Appearance
          </h2>
          <div className="rounded-lg bg-surface p-3 ring-1 ring-line ring-inset">
            <AppearanceControl initial={appearance} />
          </div>
          <p className="px-4 text-footnote text-ink-subtle">
            Dark is CreatorCo&rsquo;s signature look. System follows your device.
          </p>
        </section>

        <ListGroup id="sign-in" label="Sign-in">
          <ListRow label="Email" value={user.email} />
          <ListRow
            label="Mobile"
            value={mobile?.maskedMobile ?? "Not verified"}
            accessory={mobile ? <StatusBadge tone="success">Verified</StatusBadge> : null}
          />
        </ListGroup>

        <ListGroup id="privacy" label="Privacy">
          <ListRow
            href="/account/consents"
            label="Consent centre"
            detail={`${onCount} of ${consents.length} consents on · receipts and withdrawal`}
          />
        </ListGroup>

        <div>
          <SignOutForm variant="destructive" />
        </div>
      </div>
    </CreatorShell>
  );
}
