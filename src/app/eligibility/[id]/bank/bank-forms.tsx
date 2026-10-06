"use client";

import { useActionState, useState } from "react";

import { ChoiceFieldset, FormField, FormMessage, RadioRow } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";

import { saveCoverageAction, startBankSharingAction } from "../../actions";

/** Starts an Account Aggregator journey for one mobile number. The number is never echoed back after an error. */
export function ShareForm({
  applicationId,
  defaultMobile,
  label,
  description,
  cta,
}: {
  applicationId: string;
  defaultMobile: string | null;
  label: string;
  description: string;
  cta: string;
}) {
  const [state, action] = useActionState(startBankSharingAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <FormField id="mobile" label={label} description={description} errors={state.fieldErrors?.mobile} required>
        {(a11y) => (
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[17px] text-ink-muted"
            >
              +91
            </span>
            <Input
              {...a11y}
              name="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={14}
              defaultValue={defaultMobile ?? ""}
              className="pl-13 tabular-nums"
            />
          </div>
        )}
      </FormField>
      <div>
        <SubmitButton size="lg" className="w-full sm:w-auto">
          {cta}
        </SubmitButton>
      </div>
    </form>
  );
}

export function CoverageForm({
  applicationId,
  saved,
  reasons,
}: {
  applicationId: string;
  saved: { allShared: boolean | null; missingReason: string | null };
  reasons: { value: string; label: string }[];
}) {
  const [state, action] = useActionState(saveCoverageAction, initialFormState);
  const initial = state.values?.allShared ?? (saved.allShared === null ? "" : saved.allShared ? "yes" : "no");
  const [answer, setAnswer] = useState(typeof initial === "string" ? initial : "");
  const reason = (state.values?.missingReason as string | undefined) ?? saved.missingReason ?? "";
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <ChoiceFieldset
        id="allShared"
        legend="Have you shared every account where you receive creator income?"
        description="Brand payments, platform payouts and affiliate income. A partner lender needs to know if some are missing."
        errors={state.fieldErrors?.allShared}
        required
      >
        <RadioRow
          name="allShared"
          value="yes"
          label="Yes, all of them"
          defaultChecked={answer === "yes"}
          onChange={() => setAnswer("yes")}
        />
        <RadioRow
          name="allShared"
          value="no"
          label="No, some are missing"
          defaultChecked={answer === "no"}
          onChange={() => setAnswer("no")}
        />
      </ChoiceFieldset>
      {answer === "no" ? (
        <ChoiceFieldset
          id="missingReason"
          legend="Why are they missing?"
          errors={state.fieldErrors?.missingReason}
          required
        >
          {reasons.map((r) => (
            <RadioRow
              key={r.value}
              name="missingReason"
              value={r.value}
              label={r.label}
              defaultChecked={reason === r.value}
            />
          ))}
        </ChoiceFieldset>
      ) : null}
      <div>
        <SubmitButton size="lg" className="w-full sm:w-auto">
          Continue to review
        </SubmitButton>
      </div>
    </form>
  );
}
