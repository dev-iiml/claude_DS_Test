"use client";

import { useActionState } from "react";

import { CheckboxRow, ConsentText, FieldError, FormMessage, type ConsentTextDefinition } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { initialFormState } from "@/lib/forms";

import { shareWithLenderAction } from "../actions";

/** The "Share with a partner lender" consent, given from the check. */
export function ShareForm({ applicationId, definition }: { applicationId: string; definition: ConsentTextDefinition }) {
  const [state, action] = useActionState(shareWithLenderAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="consentDefinitionId" value={definition.id} />
      <Card>
        <CardContent>
          <ConsentText id="lender-consent-text" definition={definition} />
        </CardContent>
        <CardFooter className="flex-col items-stretch">
          <CheckboxRow
            name="agree"
            label="I agree to CreatorCo sending my confirmed checks to a partner lender as described"
            aria-describedby={["lender-consent-text", e.agree ? "lender-agree-error" : null].filter(Boolean).join(" ")}
            aria-invalid={e.agree ? true : undefined}
          />
          <FieldError id="lender-agree-error" errors={e.agree} />
        </CardFooter>
      </Card>
      <div>
        <SubmitButton size="lg" className="w-full sm:w-auto">
          Share with a partner lender
        </SubmitButton>
      </div>
    </form>
  );
}
