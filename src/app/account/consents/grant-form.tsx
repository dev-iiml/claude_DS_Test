"use client";

import { useActionState } from "react";

import { CheckboxRow, FieldError, FormFooter, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { initialFormState } from "@/lib/forms";

import { grantPurposeAction } from "./actions";

export function GrantForm({
  purposeKey,
  definitionId,
  agreeLabel,
  submitLabel,
}: {
  purposeKey: string;
  definitionId: string;
  agreeLabel: string;
  submitLabel: string;
}) {
  const [state, action] = useActionState(grantPurposeAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="key" value={purposeKey} />
      <input type="hidden" name="consentDefinitionId" value={definitionId} />
      <CheckboxRow
        name="agree"
        label={agreeLabel}
        aria-describedby={["consent-text", e.agree ? "agree-error" : null].filter(Boolean).join(" ")}
        aria-invalid={e.agree ? true : undefined}
      />
      <FieldError id="agree-error" errors={e.agree} />
      <FormFooter>
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
      </FormFooter>
    </form>
  );
}
