import type { Metadata } from "next";

import { getDb } from "@/db";

import { loadOnboardingStep } from "../_lib/context";
import { businessFormProps } from "../_lib/form-props";
import { OnboardingFrame } from "../_lib/frame";
import { BusinessForm } from "./business-form";

export const metadata: Metadata = { title: "Business status" };

export default async function BusinessStep() {
  const { user, ...state } = await loadOnboardingStep("business");
  const props = await businessFormProps(getDb(), user.userId, state);
  return (
    <OnboardingFrame
      step="business"
      title="How you operate"
      description="Legal form and GST registration are separate things — tell us both as they are today."
    >
      <BusinessForm {...props} />
    </OnboardingFrame>
  );
}
