import type { Metadata } from "next";

import {
  FINANCE_PURPOSES,
  INCOME_SOURCES,
  MAX_PURPOSES,
  PURPOSE_NOTE_MAX,
} from "@/modules/financial-eligibility/domain";
import { INCOME_SOURCE_LABELS, PURPOSE_LABELS } from "@/modules/financial-eligibility/presentation";

import { EligibilityFrame } from "../../_lib/frame";
import { loadApplicationStep } from "../../_lib/load";
import { backFor } from "../../_lib/steps";
import { DetailsForm } from "./details-form";

export const metadata: Metadata = { title: "Your details" };

export default async function DetailsPage({ params }: PageProps<"/eligibility/[id]/details">) {
  const { id } = await params;
  const { app } = await loadApplicationStep(id, "details");
  const confirmed = app.status === "inputs_ready";
  const editing = app.detailsCompletedAt !== null;
  return (
    <EligibilityFrame
      step="details"
      back={backFor(app, "details")}
      title="Your details"
      description={
        confirmed
          ? "Changing these sends your check back to Review, where you confirm again and we prepare a fresh recommendation."
          : "Approximate figures are fine. You can come back and change them until you confirm on Review."
      }
    >
      <DetailsForm
        applicationId={app.id}
        purposes={FINANCE_PURPOSES.map((p) => ({ value: p, label: PURPOSE_LABELS[p] }))}
        sources={INCOME_SOURCES.map((s) => ({ value: s, label: INCOME_SOURCE_LABELS[s] }))}
        maxPurposes={MAX_PURPOSES}
        noteMax={PURPOSE_NOTE_MAX}
        submitLabel={editing ? "Save changes" : "Save and continue"}
        saved={{
          purposes: app.purposes,
          purposeNote: app.purposeNote,
          requestedAmount: app.requestedAmount,
          declaredMonthlyIncome: app.declaredMonthlyIncome,
          declaredMonthlyEmi: app.declaredMonthlyEmi,
          incomeSources: app.incomeSources,
        }}
      />
    </EligibilityFrame>
  );
}
