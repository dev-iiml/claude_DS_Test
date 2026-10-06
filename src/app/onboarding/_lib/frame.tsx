import { OnboardingShell, ProgressSteps } from "@/components/creatorco";
import { SignOutForm } from "@/app/_components/sign-out-form";

import { ONBOARDING_PROGRESS, onboardingPath, previousStep, type OnboardingRouteStep } from "./steps";

export function OnboardingFrame({
  step,
  title,
  description,
  children,
}: {
  step: OnboardingRouteStep;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const back = previousStep(step);
  return (
    <OnboardingShell
      progress={<ProgressSteps steps={ONBOARDING_PROGRESS} currentKey={step} />}
      eyebrow={ONBOARDING_PROGRESS.find((s) => s.key === step)?.label}
      title={title}
      description={description}
      actions={<SignOutForm />}
      backHref={back ? onboardingPath(back) : null}
    >
      {children}
    </OnboardingShell>
  );
}
