"use client";

import { useActionState } from "react";

import { CheckboxRow, ConsentText, FieldError, FormFooter, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { initialFormState } from "@/lib/forms";

import { completeOnboardingAction } from "../actions";

interface Definition {
  id: string;
  title: string;
  purpose: string;
  body: string;
  version: number;
  activeFrom: string;
}

export function ConsentForm({ definition }: { definition: Definition }) {
  const [state, action] = useActionState(completeOnboardingAction, initialFormState);
  const e = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="consentDefinitionId" value={definition.id} />

      <Card>
        <CardContent>
          <ConsentText id="consent-body" definition={definition} />
        </CardContent>
        <CardFooter className="flex-col items-stretch">
          <CheckboxRow
            name="agree"
            label="I agree to CreatorCo using my details for my Creator Professional Profile"
            aria-describedby={["consent-body", e.agree ? "agree-error" : null].filter(Boolean).join(" ")}
            aria-invalid={e.agree ? true : undefined}
          />
          <FieldError id="agree-error" errors={e.agree} />
        </CardFooter>
      </Card>

      <FormFooter>
        <SubmitButton size="lg" pendingLabel="Completing your profile…">
          Complete profile
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
