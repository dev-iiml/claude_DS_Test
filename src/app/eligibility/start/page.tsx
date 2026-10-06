import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { logger } from "@/lib/logger";
import { CONSENT_KEYS, getActiveDefinition, hasValidConsent } from "@/modules/consent";
import { getOpenApplication } from "@/modules/financial-eligibility/application-service";

import { requireMember } from "@/app/_lib/member";

import { EligibilityFrame } from "../_lib/frame";
import { stepPath } from "../_lib/steps";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "Check financial eligibility" };

export default async function StartPage() {
  const { user } = await requireMember();
  const db = getDb();
  const open = await getOpenApplication({ db }, user.userId);
  // An open check continues — unless the consent text changed since, in which case it's asked for again here.
  const consentCurrent = open ? await hasValidConsent(db, user.userId, CONSENT_KEYS.financialEligibility) : false;
  if (open && consentCurrent) redirect(stepPath(open));
  const definition = await getActiveDefinition(db, CONSENT_KEYS.financialEligibility);
  if (!definition) {
    // Never bounce silently: without a published consent text the check can't start.
    logger.warn("eligibility.consent_definition_missing");
    return (
      <EligibilityFrame step="consent" title="Not available right now">
        <EmptyState
          title="Financial eligibility isn't available yet"
          description="We couldn't load the consent text for this check. Please try again later."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/eligibility">Back</Link>
            </Button>
          }
        />
      </EligibilityFrame>
    );
  }
  return (
    <EligibilityFrame
      step="consent"
      title={open ? "We've updated this consent" : "Before we start"}
      description={
        open
          ? "Your check is saved. Please read the updated text — it now covers sharing statements from more than one bank account — to carry on."
          : "This check has its own consent, separate from your Creator Profile. Read what we'll use and why."
      }
    >
      <StartForm
        definition={{
          id: definition.id,
          title: definition.title,
          purpose: definition.purpose,
          body: definition.body,
          version: definition.version,
        }}
      />
    </EligibilityFrame>
  );
}
