"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormField, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";

import { signInAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormField id="email" label="Email" required errors={errors.email}>
        {(a11y) => (
          <Input
            {...a11y}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={typeof state.values?.email === "string" ? state.values.email : ""}
          />
        )}
      </FormField>
      <FormField id="password" label="Password" required errors={errors.password}>
        {(a11y) => <Input {...a11y} name="password" type="password" autoComplete="current-password" required />}
      </FormField>
      <SubmitButton size="lg" className="mt-2 w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
      <p className="text-sm text-ink-muted">
        New to CreatorCo?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Apply for membership
        </Link>
      </p>
    </form>
  );
}
