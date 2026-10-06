import type { Metadata } from "next";

import { getDb } from "@/db";

import { loadOnboardingStep } from "../_lib/context";
import { aboutFormProps } from "../_lib/form-props";
import { OnboardingFrame } from "../_lib/frame";
import { AboutForm } from "./about-form";

export const metadata: Metadata = { title: "About you" };

export default async function AboutStep() {
  const { user, ...state } = await loadOnboardingStep("about");
  const props = await aboutFormProps(getDb(), user.userId, state);
  return (
    <OnboardingFrame
      step="about"
      title="About you"
      description="Your legal name stays private to CreatorCo. Your display name is how you appear across the network."
    >
      <AboutForm {...props} />
    </OnboardingFrame>
  );
}
