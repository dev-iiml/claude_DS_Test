"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FormField, FormMessage } from "@/components/creatorco";
import { RequirementChecklist } from "@/components/creatorco/password-checklist";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";
import { evaluatePassword } from "@/modules/identity/auth/password-policy";

import { signUpAction } from "../actions";

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const { checks } = evaluatePassword(password);
  const matches = confirm.length > 0 && confirm === password;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
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
        {(a11y) => (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Input
                {...a11y}
                aria-describedby={[a11y["aria-describedby"], "password-rules"].filter(Boolean).join(" ")}
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                className="pr-16"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-pressed={visible}
                aria-controls="password"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-ink-muted hover:text-foreground"
              >
                {visible ? "Hide" : "Show"}
              </button>
            </div>
            <RequirementChecklist id="password-rules" items={checks} />
          </div>
        )}
      </FormField>

      <FormField id="confirmPassword" label="Confirm password" required errors={errors.confirmPassword}>
        {(a11y) => (
          <div className="flex flex-col gap-2">
            <Input
              {...a11y}
              name="confirmPassword"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
            />
            {confirm.length > 0 ? (
              <RequirementChecklist
                id="confirm-rule"
                items={[{ key: "match", label: "Passwords match", met: matches }]}
                className="sm:grid-cols-1"
              />
            ) : null}
          </div>
        )}
      </FormField>

      <SubmitButton size="lg" className="mt-2 w-full" pendingLabel="Creating your account…">
        Create account
      </SubmitButton>
      <p className="text-footnote text-ink-subtle">
        When you join, CreatorCo notes which campaign link or kind of site (search, social or other) brought you here —
        never your browsing or contact details. Details are under Account › Consent centre › Service measurement once
        you’ve joined.
      </p>
      <p className="text-sm text-ink-muted">
        Already a member?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
