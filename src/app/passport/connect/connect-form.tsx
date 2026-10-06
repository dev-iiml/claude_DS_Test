"use client";

import { useActionState } from "react";

import {
  CheckboxRow,
  ChoiceFieldset,
  ConsentText,
  FieldError,
  FormFooter,
  FormMessage,
  RadioRow,
  SwitchRow,
  type ConsentTextDefinition,
} from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { initialFormState } from "@/lib/forms";

import { startConnectionAction } from "../connect-actions";

export function ConnectForm({
  platforms,
  selected,
  connectionConsent,
  analyticsConsent,
  analyticsOn,
  additional = false,
}: {
  platforms: { code: string; label: string; declaredHandle: string | null }[];
  selected: string | null;
  additional?: boolean;
  connectionConsent: ConsentTextDefinition;
  analyticsConsent: ConsentTextDefinition | null;
  analyticsOn: boolean;
}) {
  const [state, action] = useActionState(startConnectionAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const only = platforms.length === 1 ? platforms[0] : null;

  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="connectionConsentId" value={connectionConsent.id} />
      {additional ? <input type="hidden" name="additional" value="1" /> : null}

      {only ? (
        <input type="hidden" name="platform" value={only.code} />
      ) : (
        <ChoiceFieldset id="platform" legend="Platform" required>
          {platforms.map((p) => (
            <RadioRow
              key={p.code}
              name="platform"
              value={p.code}
              label={p.label}
              description={p.declaredHandle ? `You declared @${p.declaredHandle}` : undefined}
              defaultChecked={p.code === (selected ?? platforms[0]?.code)}
            />
          ))}
        </ChoiceFieldset>
      )}

      <Card>
        <CardContent>
          <ConsentText id="connection-consent" definition={connectionConsent} />
        </CardContent>
        <CardFooter className="flex-col items-stretch">
          <CheckboxRow
            name="agree"
            label="I agree to connect this account for my Creator Passport"
            aria-describedby={["connection-consent", e.agree ? "agree-error" : null].filter(Boolean).join(" ")}
            aria-invalid={e.agree ? true : undefined}
          />
          <FieldError id="agree-error" errors={e.agree} />
        </CardFooter>
      </Card>

      {analyticsConsent && !analyticsOn ? (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <input type="hidden" name="analyticsConsentId" value={analyticsConsent.id} />
            <SwitchRow
              name="analytics"
              label="Also turn on professional signals"
              description="Optional and separate. You can turn this on or off later."
              aria-describedby="analytics-consent"
            />
            <details className="group">
              <summary className="cursor-pointer py-1 text-subhead text-gold">Read what this means</summary>
              <ConsentText id="analytics-consent" definition={analyticsConsent} className="mt-3" />
            </details>
          </CardContent>
        </Card>
      ) : null}

      <FormFooter>
        <SubmitButton size="lg" pendingLabel="Opening…">
          {only ? `Continue to ${only.label}` : "Continue"}
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
