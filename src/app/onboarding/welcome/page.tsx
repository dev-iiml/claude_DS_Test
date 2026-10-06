import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";

import { loadOnboardingStep } from "../_lib/context";
import { OnboardingFrame } from "../_lib/frame";
import { onboardingPath } from "../_lib/steps";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomeStep() {
  const { profile } = await loadOnboardingStep("welcome");
  return (
    <OnboardingFrame
      step="welcome"
      title="Welcome to CreatorCo"
      description="CreatorCo is a professional and financial network that recognises creators for the business they have actually built."
    >
      <ul className="flex flex-col gap-4 text-subhead leading-relaxed">
        <li className="border-l-2 border-line-strong pl-4">
          We&rsquo;ll start with your <strong className="font-medium">Creator Professional Profile</strong> — who you
          are, what you create and how you operate.
        </li>
        <li className="border-l-2 border-line-strong pl-4">
          Your progress is saved after every step, so you can stop and come back.
        </li>
        <li className="border-l-2 border-line-strong pl-4">
          Financial eligibility is a separate, optional step later — with its own consent.
        </li>
      </ul>
      <div className="mt-10">
        <Button asChild size="lg">
          <Link href={onboardingPath("about")}>{profile ? "Continue" : "Begin"}</Link>
        </Button>
      </div>
    </OnboardingFrame>
  );
}
