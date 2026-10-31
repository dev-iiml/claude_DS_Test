"use client";

import { useActionState, useState } from "react";

import { CheckboxRow, ConsentText, FieldError, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { initialFormState } from "@/lib/forms";
import type { ConfirmationMethod } from "@/modules/brand-work/domain";
import { CONFIRMATION_METHOD_COPY } from "@/modules/brand-work/presentation";

import { chooseConfirmationAction, deleteDraftAction, submitRecordAction } from "../actions";

type Definition = { id: string; title: string; purpose: string; body: string; version: number };

export function SubmitRecordForm({ recordId, resubmit }: { recordId: string; resubmit: boolean }) {
  const [state, action] = useActionState(submitRecordAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="recordId" value={recordId} />
      <div>
        <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel="Sending…">
          {resubmit ? "Send again for verification" : "Send for verification"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeleteDraftForm({ recordId }: { recordId: string }) {
  const [state, action] = useActionState(deleteDraftAction, initialFormState);
  return (
    <details className="group">
      <summary className="cursor-pointer list-none px-1 text-subhead text-danger [&::-webkit-details-marker]:hidden">
        Delete draft…
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-3" noValidate>
        <FormMessage state={state} />
        <input type="hidden" name="recordId" value={recordId} />
        <p className="px-1 text-footnote text-ink-muted">The draft and its documents are deleted for good.</p>
        <div>
          <SubmitButton variant="destructive" size="sm" pendingLabel="Deleting…">
            Yes, delete this draft
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}

/**
 * Payment confirmation: the options side by side with equal weight. None is
 * preselected or highlighted; the points are the same whichever is chosen.
 */
export function ConfirmationForm({
  recordId,
  methods,
  bankConsent,
  pointsLine,
}: {
  recordId: string;
  methods: ConfirmationMethod[];
  bankConsent: Definition | null;
  pointsLine: string;
}) {
  const [state, action] = useActionState(chooseConfirmationAction, initialFormState);
  const [chosen, setChosen] = useState<ConfirmationMethod | null>(null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="recordId" value={recordId} />
      <fieldset className="flex flex-col gap-3">
        <legend className="px-1 pb-2 text-subhead text-ink-muted">{pointsLine}</legend>
        <div className={`grid grid-cols-1 gap-3 ${methods.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {methods.map((m) => (
            <label
              key={m}
              className="flex cursor-pointer flex-col gap-1 rounded-lg bg-surface p-4 ring-1 ring-line ring-inset has-[:checked]:ring-2 has-[:checked]:ring-ink"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="method"
                  value={m}
                  className="size-4 accent-current"
                  onChange={() => setChosen(m)}
                  aria-describedby={`method-${m}-detail`}
                />
                <span className="text-body font-medium">{CONFIRMATION_METHOD_COPY[m].label}</span>
              </span>
              <span id={`method-${m}-detail`} className="text-footnote text-ink-muted">
                {CONFIRMATION_METHOD_COPY[m].detail}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {chosen === "aa_match" && bankConsent ? (
        <Card>
          <CardContent>
            <ConsentText id="bank-match-consent-text" definition={bankConsent} />
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <input type="hidden" name="consentDefinitionId" value={bankConsent.id} />
            <CheckboxRow
              name="agree"
              label="I agree to CreatorCo checking my shared bank data for this payment"
              aria-describedby="bank-match-consent-text"
              aria-invalid={state.fieldErrors?.agree ? true : undefined}
            />
            <FieldError id="agree-error" errors={state.fieldErrors?.agree} />
          </CardFooter>
        </Card>
      ) : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Continue
        </SubmitButton>
      </div>
    </form>
  );
}
