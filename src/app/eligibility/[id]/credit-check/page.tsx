import Link from "next/link";
import type { Metadata } from "next";

import { ListGroup, ListRow } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { BUREAU_BAND_LABELS } from "@/modules/financial-eligibility/presentation";
import { getIdentityPrefill } from "@/modules/identity/identity-prefill";

import { EligibilityFrame } from "../../_lib/frame";
import { loadApplicationStep } from "../../_lib/load";
import { backFor, stepPath } from "../../_lib/steps";
import { PanForm } from "./pan-form";

export const metadata: Metadata = { title: "Credit check" };

export default async function CreditCheckPage({ params }: PageProps<"/eligibility/[id]/credit-check">) {
  const { id } = await params;
  const { user, app } = await loadApplicationStep(id, "credit-check");
  const verified = await getIdentityPrefill(getDb(), user.userId);

  return (
    <EligibilityFrame
      step="credit-check"
      back={backFor(app, "credit-check")}
      title="Credit check"
      description="A partner credit bureau tells us a summary of your credit history: a band, and counts of accounts, missed payments and recent enquiries."
    >
      {app.bureauStatus === "completed" && app.bureauScoreBand ? (
        <div className="flex flex-col gap-8">
          <ListGroup
            id="done"
            label="Already checked"
            footer="Each check is a credit enquiry, so run it again only if something has changed."
          >
            <ListRow
              label="Credit history"
              value={BUREAU_BAND_LABELS[app.bureauScoreBand]}
              detail={app.panMasked ? `PAN ${app.panMasked}` : undefined}
            />
          </ListGroup>
          <div>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={app.status === "inputs_ready" ? stepPath(app, "summary") : stepPath(app)}>Continue</Link>
            </Button>
          </div>
          <details className="group rounded-[16px] bg-surface p-4 ring-1 ring-line ring-inset">
            <summary className="cursor-pointer text-[15px] font-medium text-ink-muted">
              Run the credit check again
            </summary>
            <div className="mt-5">
              <PanForm applicationId={app.id} verifiedPanMasked={verified?.panMasked ?? null} />
            </div>
          </details>
        </div>
      ) : (
        <PanForm applicationId={app.id} verifiedPanMasked={verified?.panMasked ?? null} />
      )}
    </EligibilityFrame>
  );
}
