"use client";

import { useActionState } from "react";

import { CheckboxRow, FieldError, FormField, FormFooter, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";

import { creditCheckAction } from "../../actions";

/** The PAN is submitted once and never echoed back into form state. */
export function PanForm({
  applicationId,
  verifiedPanMasked,
}: {
  applicationId: string;
  verifiedPanMasked: string | null;
}) {
  const [state, action] = useActionState(creditCheckAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-7" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <FormField
        id="pan"
        label="Your PAN"
        description={
          verifiedPanMasked
            ? `Must match your verified PAN (${verifiedPanMasked}). Used once for this check; we keep only the masked form.`
            : "10 characters, as printed on your PAN card. Used once for this check through a partner bureau; we keep only a masked form."
        }
        errors={e.pan}
        required
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="pan"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={10}
            className="font-mono tracking-[0.12em] uppercase"
          />
        )}
      </FormField>
      <p className="text-footnote leading-snug text-ink-muted">
        The bureau records this check as a credit enquiry on your report. Several enquiries in a short time can affect
        how lenders see your credit profile.
      </p>
      <div className="flex flex-col gap-2">
        <CheckboxRow
          name="confirm"
          label="This is my PAN, and I'd like CreatorCo to request my credit bureau summary"
          aria-invalid={e.confirm ? true : undefined}
          aria-describedby={e.confirm ? "confirm-error" : undefined}
        />
        <FieldError id="confirm-error" errors={e.confirm} />
      </div>
      <FormFooter>
        <SubmitButton size="lg" pendingLabel="Checking…">
          Run credit check
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
