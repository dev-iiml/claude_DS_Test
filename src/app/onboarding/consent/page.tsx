import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { CONSENT_KEYS, getActiveDefinition } from "@/modules/consent";

import { loadOnboardingStep } from "../_lib/context";
import { OnboardingFrame } from "../_lib/frame";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Creator Profile consent" };

export default async function ConsentStep() {
  await loadOnboardingStep("consent");
  const definition = await getActiveDefinition(getDb(), CONSENT_KEYS.creatorProfile);

  return (
    <OnboardingFrame
      step="consent"
      title="Your Creator Profile consent"
      description="We ask for consent separately for each purpose. This one covers your profile only."
    >
      {definition ? (
        <ConsentForm
          definition={{
            id: definition.id,
            title: definition.title,
            purpose: definition.purpose,
            body: definition.body,
            version: definition.version,
            activeFrom: definition.activeFrom.toISOString().slice(0, 10),
          }}
        />
      ) : (
        <Alert tone="danger" title="Consent is temporarily unavailable">
          We can&rsquo;t show the consent text right now, so we can&rsquo;t complete your profile. Please try again
          later.
        </Alert>
      )}
    </OnboardingFrame>
  );
}
