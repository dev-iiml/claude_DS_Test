"use client";

import { useActionState } from "react";

import {
  CheckboxRow,
  ConsentText,
  FieldError,
  FormField,
  FormMessage,
  type ConsentTextDefinition,
} from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { fieldClasses } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { initialFormState } from "@/lib/forms";
import { MAX_REQUEST_NOTE } from "@/modules/access/domain";

import { cancelAccessRequestAction, requestAccessAction } from "../actions";

/** Request access: optional note, plus the brand opportunities consent the first time. */
export function RequestAccessForm({
  opportunityId,
  costLabel,
  definition,
}: {
  opportunityId: string;
  costLabel: string;
  /** The consent to agree to, when the creator hasn't given it yet. */
  definition: ConsentTextDefinition | null;
}) {
  const [state, action] = useActionState(requestAccessAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <FormField
        id="note"
        label="Note to the brand team"
        optionalLabel
        description="Why this fits your work — a sentence or two."
        errors={e.note}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            name="note"
            rows={3}
            maxLength={MAX_REQUEST_NOTE}
            defaultValue={String(state.values?.note ?? "")}
            className={cn(fieldClasses, "h-auto py-3")}
          />
        )}
      </FormField>
      {definition ? (
        <>
          <input type="hidden" name="consentDefinitionId" value={definition.id} />
          <Card>
            <CardContent>
              <ConsentText id="brand-consent-text" definition={definition} />
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3">
              <CheckboxRow
                name="agree"
                label="I agree to CreatorCo considering my requests for brand opportunities"
                aria-describedby={["brand-consent-text", e.agree ? "agree-error" : null].filter(Boolean).join(" ")}
                aria-invalid={e.agree ? true : undefined}
              />
              <FieldError id="agree-error" errors={e.agree} />
            </CardFooter>
          </Card>
        </>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel="Requesting…">
          Request access
        </SubmitButton>
        <span className="text-footnote text-ink-subtle">
          {costLabel === "No points needed" ? "No points needed." : `${costLabel} held until the team decides.`}
        </span>
      </div>
    </form>
  );
}

export function CancelRequestForm({ requestId, opportunityId }: { requestId: string; opportunityId: string }) {
  const [state, action] = useActionState(cancelAccessRequestAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Cancelling…">
          Cancel request
        </SubmitButton>
      </div>
    </form>
  );
}
