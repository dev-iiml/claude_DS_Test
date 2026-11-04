"use client";

import { useActionState } from "react";

import { FormField, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { initialFormState } from "@/lib/forms";

import { brandUnlockAction, reportPassportAction, unlockWithCodeAction } from "./actions";

export function UnlockForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(unlockWithCodeAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <FormField id="code" label="Access code" errors={e.code} required>
        {(a11y) => (
          <Input
            {...a11y}
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="font-mono sm:max-w-xs"
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="name" label="Your name" description="Shown to the creator as unverified.">
          {(a11y) => <Input {...a11y} name="name" maxLength={60} autoComplete="name" />}
        </FormField>
        <FormField id="company" label="Company" description="Shown to the creator as unverified.">
          {(a11y) => <Input {...a11y} name="company" maxLength={80} autoComplete="organization" />}
        </FormField>
      </div>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Checking…">
          Unlock
        </SubmitButton>
      </div>
    </form>
  );
}

export function BrandUnlockForm({ slug, orgName }: { slug: string; orgName: string }) {
  const [state, action] = useActionState(brandUnlockAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <p className="text-footnote text-ink-muted">
        The creator will see that {orgName} (verified) unlocked their Passport today. It counts towards your
        organisation&apos;s daily unlocks.
      </p>
      <div>
        <SubmitButton pendingLabel="Unlocking…">Unlock as {orgName}</SubmitButton>
      </div>
    </form>
  );
}

export function ReportForm({ slug, reasons }: { slug: string; reasons: { value: string; label: string }[] }) {
  const [state, action] = useActionState(reportPassportAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <FormField id="reason" label="What's wrong with this page?" errors={state.fieldErrors?.reason} required>
        {(a11y) => (
          <NativeSelect {...a11y} name="reason" defaultValue="" className="sm:max-w-sm">
            <option value="" disabled>
              Choose a reason
            </option>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
          Send report
        </SubmitButton>
      </div>
    </form>
  );
}
