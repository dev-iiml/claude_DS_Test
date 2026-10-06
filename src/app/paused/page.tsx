import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ListGroup, ListRow, PageHeader } from "@/components/creatorco";
import { Button } from "@/components/ui/button";

import { requireConsentCentreAccess } from "../_lib/member";
import { PausedShell } from "./paused-shell";

export const metadata: Metadata = { title: "Membership paused" };

export default async function PausedPage() {
  const { paused } = await requireConsentCentreAccess();
  if (!paused) redirect("/dashboard");
  return (
    <PausedShell>
      <PageHeader
        eyebrow="Membership"
        title="Your membership is paused"
        description="You withdrew consent for your Creator Professional Profile, so we've stopped processing it. Your details are kept, and you can resume whenever you like."
      />
      <div className="flex flex-col gap-8">
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href="/account/consents/creator_profile">Resume membership</Link>
        </Button>
        <ListGroup id="paused-options" label="While paused">
          <ListRow href="/account/consents" label="Consent centre" detail="Review or withdraw any other consent." />
        </ListGroup>
        <p className="px-1 text-[13px] leading-snug text-ink-subtle">
          Want to close your account instead? Account closure is handled as a separate request and isn&rsquo;t available
          in this pilot build yet.
        </p>
      </div>
    </PausedShell>
  );
}
