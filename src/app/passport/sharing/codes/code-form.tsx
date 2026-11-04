"use client";

import { useActionState } from "react";

import { FormField, FormMessage, SegmentedControl } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";
import { CODE_EXPIRY_DAYS } from "@/modules/public-passport/domain";

import { createCodeAction, type CodeFormState } from "../actions";

const dayMonth = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/** Creates a code. The code itself is shown here once and can't be shown again. */
export function CodeForm() {
  const [state, action] = useActionState<CodeFormState, FormData>(createCodeAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const v = (k: string, d: string) => (typeof state.values?.[k] === "string" ? (state.values[k] as string) : d);
  return (
    <div className="flex flex-col gap-5">
      {state.created ? (
        <Alert tone="success" title={`Code for “${state.created.label}”`}>
          <p className="mt-1 font-mono text-title-3 tracking-wider select-all" data-testid="new-access-code">
            {state.created.display}
          </p>
          <p className="mt-2">
            Copy it now — it won&apos;t be shown again. It works until{" "}
            {dayMonth.format(new Date(state.created.expiresAt))}.
          </p>
        </Alert>
      ) : null}
      <form action={action} className="flex flex-col gap-5" noValidate>
        <FormMessage state={state} />
        <FormField
          id="label"
          label="Label"
          required
          description="Who it's for, so you recognise it in the log — for example “Agency pitch”."
          errors={e.label}
        >
          {(a11y) => <Input {...a11y} name="label" maxLength={60} autoComplete="off" />}
        </FormField>
        <div className="flex flex-col gap-2">
          <p className="text-subhead font-medium">Expires after</p>
          <SegmentedControl
            name="days"
            legend="Expires after"
            options={CODE_EXPIRY_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))}
            defaultValue={v("days", "30")}
          />
        </div>
        <FormField id="maxUses" label="Maximum uses" description="Leave empty for no limit." errors={e.maxUses}>
          {(a11y) => (
            <Input {...a11y} name="maxUses" inputMode="numeric" defaultValue={v("maxUses", "")} className="max-w-40" />
          )}
        </FormField>
        <div>
          <SubmitButton pendingLabel="Creating…">Create code</SubmitButton>
        </div>
      </form>
    </div>
  );
}
