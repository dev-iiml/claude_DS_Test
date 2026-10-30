"use client";

import { useActionState } from "react";

import {
  CheckboxRow,
  ConsentText,
  FieldError,
  FormFooter,
  FormMessage,
  type ConsentTextDefinition,
} from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { initialFormState } from "@/lib/forms";

import { enableSignalsAction } from "../connect-actions";

export function EnableSignalsForm({ definition }: { definition: ConsentTextDefinition }) {
  const [state, action] = useActionState(enableSignalsAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="consentDefinitionId" value={definition.id} />
      <Card>
        <CardContent>
          <ConsentText id="analytics-consent" definition={definition} />
        </CardContent>
        <CardFooter className="flex-col items-stretch">
          <CheckboxRow
            name="agree"
            label="Turn on professional signals for my Passport"
            aria-describedby={["analytics-consent", e.agree ? "agree-error" : null].filter(Boolean).join(" ")}
            aria-invalid={e.agree ? true : undefined}
          />
          <FieldError id="agree-error" errors={e.agree} />
        </CardFooter>
      </Card>
      <FormFooter>
        <SubmitButton size="lg" pendingLabel="Computing signals…">
          Turn on signals
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
