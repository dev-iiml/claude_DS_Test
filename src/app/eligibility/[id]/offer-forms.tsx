"use client";

import { Button } from "@/components/ui/button";
import { useActionState, useState } from "react";

import {
  CheckboxRow,
  ConsentText,
  FieldError,
  FormMessage,
  RadioRow,
  ChoiceFieldset,
  type ConsentTextDefinition,
} from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { initialFormState } from "@/lib/forms";
import { OFFER_DECLINE_REASONS } from "@/modules/lending/domain";
import { OFFER_DECLINE_REASON_LABELS } from "@/modules/lending/presentation";

import { acceptOfferAction, declineOfferAction } from "../actions";

/** Accept: KFS acknowledgement + the "Continue with the partner lender" consent, bound to the terms on screen. */
export function AcceptOfferForm({
  applicationId,
  termsHash,
  lenderName,
  definition,
}: {
  applicationId: string;
  termsHash: string;
  lenderName: string;
  definition: ConsentTextDefinition;
}) {
  const [state, action] = useActionState(acceptOfferAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="termsHash" value={termsHash} />
      <input type="hidden" name="consentDefinitionId" value={definition.id} />
      <Card>
        <CardContent>
          <ConsentText id="handoff-consent-text" definition={definition} />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <CheckboxRow
            name="kfs"
            label="I've read the Key Fact Statement above"
            aria-invalid={e.kfs ? true : undefined}
            aria-describedby={e.kfs ? "kfs-error" : undefined}
          />
          <FieldError id="kfs-error" errors={e.kfs} />
          <CheckboxRow
            name="agree"
            label={`I agree to CreatorCo passing my acceptance and contact details to ${lenderName}`}
            aria-describedby={["handoff-consent-text", e.agree ? "agree-error" : null].filter(Boolean).join(" ")}
            aria-invalid={e.agree ? true : undefined}
          />
          <FieldError id="agree-error" errors={e.agree} />
        </CardFooter>
      </Card>
      <div>
        <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel="Accepting…">
          Accept offer
        </SubmitButton>
      </div>
    </form>
  );
}

/** Decline, with an optional reason — as visible as accepting (QA pass: answering either way is equally easy). */
export function DeclineOfferForm({ applicationId }: { applicationId: string }) {
  const [state, action] = useActionState(declineOfferAction, initialFormState);
  const [reason, setReason] = useState<string>("");
  return (
    <details className="group">
      <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">Decline this offer</summary>
      </Button>
      <form action={action} className="mt-4 flex flex-col gap-4" noValidate>
        <FormMessage state={state} />
        <input type="hidden" name="applicationId" value={applicationId} />
        <ChoiceFieldset id="decline-reason" legend="Tell us why">
          {OFFER_DECLINE_REASONS.map((r) => (
            <RadioRow
              key={r}
              name="reason"
              value={r}
              label={OFFER_DECLINE_REASON_LABELS[r]}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
          ))}
        </ChoiceFieldset>
        <div>
          <SubmitButton variant="secondary" pendingLabel="Declining…">
            Decline offer
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
