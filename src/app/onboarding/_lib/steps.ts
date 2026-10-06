import type { OnboardingStep } from "@/modules/creator-profile/domain";

export type OnboardingRouteStep = "welcome" | OnboardingStep;

export const ONBOARDING_PROGRESS: { key: OnboardingRouteStep; label: string }[] = [
  { key: "welcome", label: "Welcome" },
  { key: "about", label: "About you" },
  { key: "profile", label: "Creator profile" },
  { key: "business", label: "Business status" },
  { key: "interests", label: "Professional interests" },
  { key: "consent", label: "Creator Profile consent" },
];

export function onboardingPath(step: OnboardingRouteStep | "done"): string {
  return step === "done" ? "/dashboard" : `/onboarding/${step}`;
}

export function previousStep(step: OnboardingRouteStep): OnboardingRouteStep | null {
  const i = ONBOARDING_PROGRESS.findIndex((s) => s.key === step);
  return i > 0 ? (ONBOARDING_PROGRESS[i - 1]?.key ?? null) : null;
}
