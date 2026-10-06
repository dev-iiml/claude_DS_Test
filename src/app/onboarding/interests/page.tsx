import type { Metadata } from "next";

import { getDb } from "@/db";

import { loadOnboardingStep } from "../_lib/context";
import { interestsFormProps } from "../_lib/form-props";
import { OnboardingFrame } from "../_lib/frame";
import { InterestsForm } from "./interests-form";

export const metadata: Metadata = { title: "Professional interests" };

export default async function InterestsStep() {
  const { user: _user, ...state } = await loadOnboardingStep("interests");
  const props = await interestsFormProps(getDb(), state);
  return (
    <OnboardingFrame
      step="interests"
      title="Professional interests"
      description="This shapes the brand programmes and access we show you. You can change it any time."
    >
      <InterestsForm {...props} />
    </OnboardingFrame>
  );
}
