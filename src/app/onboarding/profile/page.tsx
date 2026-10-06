import type { Metadata } from "next";

import { getDb } from "@/db";

import { loadOnboardingStep } from "../_lib/context";
import { profileFormProps } from "../_lib/form-props";
import { OnboardingFrame } from "../_lib/frame";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Creator profile" };

export default async function ProfileStep() {
  const { user: _user, ...state } = await loadOnboardingStep("profile");
  const props = await profileFormProps(getDb(), state);
  return (
    <OnboardingFrame
      step="profile"
      title="Your creator profile"
      description="Tell us what you create and where. You can connect accounts to verify them once your profile is complete."
    >
      <ProfileForm {...props} />
    </OnboardingFrame>
  );
}
