"use client";

import { useActionState, useState } from "react";

import { CheckboxRow, ChoiceFieldset, FormField, FormMessage, RadioRow } from "@/components/creatorco";
import { RequirementChecklist } from "@/components/creatorco/password-checklist";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { initialFormState, type FormState } from "@/lib/forms";
import {
  BRAND_TERMS,
  IDENTIFIER_LABELS,
  IDENTIFIER_TYPES,
  ORG_TYPE_LABELS,
  ORG_TYPES,
} from "@/modules/brand-orgs/domain";
import { evaluatePassword } from "@/modules/identity/auth/password-policy";

import {
  acceptInviteAction,
  completeBrandSignupAction,
  inviteMemberAction,
  requestBrandCodeAction,
  type InviteState,
} from "./actions";

const val = (state: FormState, k: string, d = "") =>
  typeof state.values?.[k] === "string" ? (state.values[k] as string) : d;

function Terms() {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-4 ring-1 ring-line ring-inset" id="brand-terms">
      <p className="text-subhead font-semibold">Brand terms</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-subhead leading-snug text-ink-muted">
        {BRAND_TERMS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function PasswordField({ errors }: { errors?: string[] }) {
  const [password, setPassword] = useState("");
  const { checks } = evaluatePassword(password);
  return (
    <FormField id="password" label="Password" required errors={errors}>
      {(a11y) => (
        <div className="flex flex-col gap-3">
          <Input
            {...a11y}
            aria-describedby={[a11y["aria-describedby"], "password-rules"].filter(Boolean).join(" ")}
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <RequirementChecklist id="password-rules" items={checks} />
        </div>
      )}
    </FormField>
  );
}

export function BrandEmailForm() {
  const [state, action] = useActionState(requestBrandCodeAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <FormField
        id="email"
        label="Work email"
        required
        description="Your organisation's own domain — personal email addresses can't be used."
        errors={state.fieldErrors?.email}
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            defaultValue={val(state, "email")}
          />
        )}
      </FormField>
      <SubmitButton size="lg" pendingLabel="Sending…">
        Send a code
      </SubmitButton>
    </form>
  );
}

export function BrandDetailsForm({ challengeId }: { challengeId: string }) {
  const [state, action] = useActionState(completeBrandSignupAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const [idType, setIdType] = useState(val(state, "identifierType", "cin"));
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="challengeId" value={challengeId} />
      <FormField id="code" label="Code from the email" required errors={e.code}>
        {(a11y) => (
          <Input
            {...a11y}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="max-w-40 font-mono"
          />
        )}
      </FormField>
      <PasswordField errors={e.password} />
      <FormField id="legalName" label="Organisation's legal name" required errors={e.legalName}>
        {(a11y) => (
          <Input {...a11y} name="legalName" autoComplete="organization" defaultValue={val(state, "legalName")} />
        )}
      </FormField>
      <ChoiceFieldset id="orgType" legend="You are" required errors={e.orgType}>
        {ORG_TYPES.map((t) => (
          <RadioRow
            key={t}
            name="orgType"
            value={t}
            label={ORG_TYPE_LABELS[t]}
            description={
              t === "brand"
                ? "A company that sells products or services."
                : "An agency or platform working on behalf of brands."
            }
            defaultChecked={val(state, "orgType", "brand") === t}
          />
        ))}
      </ChoiceFieldset>
      <FormField id="website" label="Website" required errors={e.website}>
        {(a11y) => (
          <Input {...a11y} name="website" type="url" placeholder="https://" defaultValue={val(state, "website")} />
        )}
      </FormField>
      <FormField
        id="identifierType"
        label="Company identifier"
        required
        description="From the Ministry of Corporate Affairs register."
      >
        {(a11y) => (
          <NativeSelect
            {...a11y}
            name="identifierType"
            value={idType}
            onChange={(ev) => setIdType(ev.currentTarget.value)}
          >
            {IDENTIFIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {IDENTIFIER_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="identifierValue" label={idType === "llpin" ? "LLPIN" : "CIN"} required errors={e.identifierValue}>
        {(a11y) => (
          <Input
            {...a11y}
            name="identifierValue"
            autoCapitalize="characters"
            spellCheck={false}
            defaultValue={val(state, "identifierValue")}
            className="font-mono"
          />
        )}
      </FormField>
      <FormField
        id="gstin"
        label="GSTIN"
        description="Optional. Used only to check your organisation; CreatorCo keeps a fingerprint and the state code, never the number."
        errors={e.gstin}
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="gstin"
            autoCapitalize="characters"
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
          />
        )}
      </FormField>
      <Terms />
      <CheckboxRow
        name="acceptTerms"
        label="I accept the brand terms for my organisation"
        aria-describedby="brand-terms"
        aria-invalid={e.acceptTerms ? true : undefined}
      />
      {e.acceptTerms ? <p className="-mt-3 text-footnote text-danger">{e.acceptTerms[0]}</p> : null}
      <SubmitButton size="lg" pendingLabel="Creating…">
        Create account
      </SubmitButton>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInviteAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <PasswordField errors={state.fieldErrors?.password} />
      <Terms />
      <CheckboxRow name="acceptTerms" label="I accept the brand terms" aria-describedby="brand-terms" />
      <SubmitButton size="lg" pendingLabel="Joining…">
        Join
      </SubmitButton>
    </form>
  );
}

export function InviteForm() {
  const [state, action] = useActionState<InviteState, FormData>(inviteMemberAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      {state.status === "idle" && state.message ? (
        <Alert tone="success">
          {state.message}
          {state.mockLink ? (
            <span className="mt-2 block break-all">
              Demo mode — no email is sent. Pass on this link:{" "}
              <span className="font-mono select-all">{state.mockLink}</span>
            </span>
          ) : null}
        </Alert>
      ) : null}
      <FormField id="invite-email" label="Colleague's work email" required>
        {(a11y) => <Input {...a11y} name="email" type="email" autoComplete="off" />}
      </FormField>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Sending…">
          Send invitation
        </SubmitButton>
      </div>
    </form>
  );
}
