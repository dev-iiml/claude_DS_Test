"use client";

import { useActionState, useState } from "react";

import { CheckboxChip, ChoiceFieldset, FormField, FormFooter, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";

import { listValue, textValue } from "@/app/onboarding/_lib/form-values";

import { saveDetailsAction } from "../../actions";

interface Saved {
  purposes: string[];
  purposeNote: string | null;
  requestedAmount: number | null;
  declaredMonthlyIncome: number | null;
  declaredMonthlyEmi: number | null;
  incomeSources: string[];
}

const fmt = (n: number | null) => (n === null ? null : n.toLocaleString("en-IN"));

function RupeeInput(props: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[17px] text-ink-muted"
      >
        ₹
      </span>
      <Input inputMode="numeric" autoComplete="off" className="pl-9 tabular-nums" {...props} />
    </div>
  );
}

export function DetailsForm({
  applicationId,
  purposes,
  sources,
  saved,
  maxPurposes,
  noteMax,
  submitLabel,
}: {
  applicationId: string;
  purposes: { value: string; label: string }[];
  sources: { value: string; label: string }[];
  saved: Saved;
  maxPurposes: number;
  noteMax: number;
  submitLabel: string;
}) {
  const [state, action] = useActionState(saveDetailsAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const chosen = listValue(state, "incomeSources", saved.incomeSources);
  // Purposes are controlled so the "up to three" limit and the note field respond as you tap.
  const [picked, setPicked] = useState<string[]>(() => listValue(state, "purposes", saved.purposes));
  const [note, setNote] = useState(() => textValue(state, "purposeNote", saved.purposeNote) ?? "");
  const full = picked.length >= maxPurposes;
  const toggle = (value: string, on: boolean) =>
    setPicked((p) => (on ? [...p.filter((v) => v !== value), value] : p.filter((v) => v !== value)));

  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="applicationId" value={applicationId} />

      <ChoiceFieldset
        id="purposes"
        legend="What would you use the funds for?"
        description={`Choose up to ${maxPurposes}. The first you pick is treated as the main one.`}
        errors={e.purposes}
        required
      >
        <div className="flex flex-wrap gap-2">
          {purposes.map((p) => {
            const on = picked.includes(p.value);
            return (
              <CheckboxChip
                key={p.value}
                name="purposes"
                value={p.value}
                label={p.label}
                checked={on}
                disabled={!on && full}
                onChange={(ev) => toggle(p.value, ev.currentTarget.checked)}
              />
            );
          })}
        </div>
        <p aria-live="polite" className="mt-2 text-[13px] text-ink-subtle">
          {full ? `That's ${maxPurposes} — untick one to choose another.` : `${picked.length} of ${maxPurposes} chosen`}
        </p>
      </ChoiceFieldset>

      {picked.includes("other") ? (
        <FormField
          id="purposeNote"
          label="Tell us in a few words"
          description={`For example "a podcast studio" or "a stall at a creator fair". Up to ${noteMax} characters.`}
          errors={e.purposeNote}
          required
        >
          {(a11y) => (
            <Input
              {...a11y}
              name="purposeNote"
              value={note}
              maxLength={noteMax}
              autoComplete="off"
              onChange={(ev) => setNote(ev.currentTarget.value)}
            />
          )}
        </FormField>
      ) : null}

      <FormField
        id="requestedAmount"
        label="Roughly how much?"
        description="Between ₹10,000 and ₹25,00,000."
        errors={e.requestedAmount}
        required
      >
        {(a11y) => (
          <RupeeInput
            {...a11y}
            name="requestedAmount"
            defaultValue={textValue(state, "requestedAmount", fmt(saved.requestedAmount))}
          />
        )}
      </FormField>

      <FormField
        id="declaredMonthlyIncome"
        label="Average monthly income"
        description="Your typical income from all sources over the last six months, before tax. It helps us understand your plans; your recommendation uses only income we can verify from bank data."
        errors={e.declaredMonthlyIncome}
        required
      >
        {(a11y) => (
          <RupeeInput
            {...a11y}
            name="declaredMonthlyIncome"
            defaultValue={textValue(state, "declaredMonthlyIncome", fmt(saved.declaredMonthlyIncome))}
          />
        )}
      </FormField>

      <ChoiceFieldset
        id="incomeSources"
        legend="Where does it come from?"
        description="Choose all that apply."
        errors={e.incomeSources}
        required
      >
        <div className="flex flex-wrap gap-2">
          {sources.map((s) => (
            <CheckboxChip
              key={s.value}
              name="incomeSources"
              value={s.value}
              label={s.label}
              defaultChecked={chosen.includes(s.value)}
            />
          ))}
        </div>
      </ChoiceFieldset>

      <FormField
        id="declaredMonthlyEmi"
        label="Existing monthly EMIs"
        description="Loan or card EMIs you already pay each month. Enter 0 if none."
        errors={e.declaredMonthlyEmi}
        required
      >
        {(a11y) => (
          <RupeeInput
            {...a11y}
            name="declaredMonthlyEmi"
            defaultValue={textValue(state, "declaredMonthlyEmi", fmt(saved.declaredMonthlyEmi))}
          />
        )}
      </FormField>

      <FormFooter>
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
      </FormFooter>
    </form>
  );
}
