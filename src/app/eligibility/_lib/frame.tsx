import { BackLink, PageHeader, ProgressSteps } from "@/components/creatorco";

import { CreatorShell } from "@/app/_components/creator-shell";

import { ELIGIBILITY_STEPS, type EligibilityStep } from "./steps";

export function EligibilityFrame({
  step,
  title,
  description,
  back = { href: "/eligibility", label: "Financial eligibility" },
  children,
}: {
  step: EligibilityStep;
  title: string;
  description?: React.ReactNode;
  /** The previous step (or the eligibility home). */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <CreatorShell>
      <BackLink href={back.href} label={back.label} />
      <div className="max-w-2xl">
        <ProgressSteps
          steps={ELIGIBILITY_STEPS}
          currentKey={step}
          label="Eligibility check progress"
          className="mb-7"
        />
        <PageHeader title={title} description={description} />
        {children}
      </div>
    </CreatorShell>
  );
}
