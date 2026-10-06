"use client";

import { useActionState } from "react";

import { ChoiceFieldset, FormFooter, FormMessage, RadioRow } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { initialFormState } from "@/lib/forms";

import { withdrawPurposeAction } from "../../actions";

export function WithdrawForm({
  purposeKey,
  reasons,
  submitLabel,
}: {
  purposeKey: string;
  reasons: { value: string; label: string }[];
  submitLabel: string;
}) {
  const [state, action] = useActionState(withdrawPurposeAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-7" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="key" value={purposeKey} />
      <ChoiceFieldset
        id="reason"
        legend="Why are you withdrawing?"
        description="Helps us improve. You don't have to say."
      >
        {reasons.map((r) => (
          <RadioRow key={r.value} name="reason" value={r.value} label={r.label} />
        ))}
      </ChoiceFieldset>
      <FormFooter>
        <SubmitButton size="lg" variant="destructive" pendingLabel="Withdrawing…">
          {submitLabel}
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
