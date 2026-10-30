"use client";

import { useActionState } from "react";

import { FormField, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { initialFormState } from "@/lib/forms";
import type { SimulatedLenderPolicy } from "@/providers/lender/simulated-policy";

import { proposePolicyAction } from "./actions";

export function PolicyForm({ current }: { current: SimulatedLenderPolicy }) {
  const [state, action] = useActionState(proposePolicyAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {state.status === "idle" && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="decisionBasis" required label="Decision basis">
          {(a11y) => (
            <NativeSelect {...a11y} name="decisionBasis" defaultValue={current.decisionBasis}>
              <option value="traditional">Traditional</option>
              <option value="creator_enhanced">Creator-Enhanced</option>
            </NativeSelect>
          )}
        </FormField>
        <FormField id="minGrade" required label="Worst grade accepted">
          {(a11y) => (
            <NativeSelect {...a11y} name="minGrade" defaultValue={current.minGrade}>
              {["A", "B", "C", "D", "E"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="maxExposure" required label="Maximum amount (₹)">
          {(a11y) => <Input {...a11y} name="maxExposure" inputMode="numeric" defaultValue={current.maxExposure} />}
        </FormField>
        <FormField id="maxTenorMonths" required label="Maximum tenor (months)">
          {(a11y) => (
            <Input {...a11y} name="maxTenorMonths" inputMode="numeric" defaultValue={current.maxTenorMonths} />
          )}
        </FormField>
        <FormField id="maxDelinquencies12m" required label="Missed payments allowed (12 months)">
          {(a11y) => (
            <Input
              {...a11y}
              name="maxDelinquencies12m"
              inputMode="numeric"
              defaultValue={current.maxDelinquencies12m}
            />
          )}
        </FormField>
        <FormField id="minBankCoverage" required label="Least bank coverage">
          {(a11y) => (
            <NativeSelect {...a11y} name="minBankCoverage" defaultValue={current.minBankCoverage}>
              <option value="none">None needed</option>
              <option value="partial">Partial</option>
              <option value="complete">Complete</option>
            </NativeSelect>
          )}
        </FormField>
        <FormField id="minCompletenessPct" required label="Least model completeness (%)">
          {(a11y) => (
            <Input
              {...a11y}
              name="minCompletenessPct"
              inputMode="numeric"
              defaultValue={Math.round(current.minCompleteness * 100)}
            />
          )}
        </FormField>
        {(["A", "B", "C", "D", "E"] as const).map((g) => (
          <FormField key={g} id={`rate${g}`} required label={`Illustrative rate, grade ${g} (% p.a.)`}>
            {(a11y) => (
              <Input
                {...a11y}
                name={`rate${g}`}
                inputMode="decimal"
                defaultValue={current.pricing.annualRatePctByGrade[g]}
              />
            )}
          </FormField>
        ))}
        <FormField id="processingFeePct" required label="Processing fee (% of amount)">
          {(a11y) => (
            <Input
              {...a11y}
              name="processingFeePct"
              inputMode="decimal"
              defaultValue={current.pricing.processingFeePct}
            />
          )}
        </FormField>
        <FormField id="offerValidDays" required label="Offer valid for (days)">
          {(a11y) => (
            <Input {...a11y} name="offerValidDays" inputMode="numeric" defaultValue={current.pricing.offerValidDays} />
          )}
        </FormField>
        <FormField id="coolingOffDays" required label="Cooling-off period (days)">
          {(a11y) => (
            <Input {...a11y} name="coolingOffDays" inputMode="numeric" defaultValue={current.pricing.coolingOffDays} />
          )}
        </FormField>
        <FormField id="note" label="Why the change">
          {(a11y) => <Input {...a11y} name="note" maxLength={500} autoComplete="off" />}
        </FormField>
      </div>
      <div>
        <SubmitButton>Propose new version</SubmitButton>
      </div>
    </form>
  );
}
