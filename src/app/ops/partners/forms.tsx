"use client";

import { useActionState, useState } from "react";

import { CheckboxRow, ChoiceFieldset, FormField, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { initialFormState } from "@/lib/forms";
import {
  DEFAULT_KEY_LIFETIME_DAYS,
  KEY_LIFETIME_DAYS,
  PARTNER_SCOPES,
  PARTNER_SCOPE_LABELS,
  ROTATION_OVERLAP_HOURS,
} from "@/modules/partners/domain";

import {
  cancelKeyAction,
  cancelWebhookAction,
  createPartnerAction,
  decideKeyAction,
  decideWebhookAction,
  proposeKeyAction,
  proposeWebhookAction,
  retireWebhookAction,
  revokeKeyAction,
  rotateSecretAction,
  setPartnerStatusAction,
  type SecretFormState,
} from "./actions";

/** Client forms for /ops → Partners. One-time secrets are shown in place and never stored client-side. */

function OneTimeSecret({ state }: { state: SecretFormState }) {
  if (!state.secret) return null;
  return (
    <Alert tone="warning" title={state.secret.label} data-testid="one-time-secret">
      <code className="my-2 block font-mono text-[13px] break-all text-ink select-all">{state.secret.value}</code>
      <span>{state.secret.note}</span>
    </Alert>
  );
}

export function CreatePartnerForm() {
  const [state, action] = useActionState(createPartnerAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="name" label="Name" required>
          {(a11y) => <Input {...a11y} name="name" maxLength={80} defaultValue={String(state.values?.name ?? "")} />}
        </FormField>
        <FormField id="key" label="Partner key" required description="Lowercase, e.g. partner_hdfc_pilot.">
          {(a11y) => <Input {...a11y} name="key" maxLength={40} defaultValue={String(state.values?.key ?? "")} />}
        </FormField>
        <FormField
          id="lenderKey"
          label="Lender config key"
          required
          description="The partner-API lender config (Integrations → Partner lender) whose proposals it receives."
        >
          {(a11y) => (
            <Input {...a11y} name="lenderKey" maxLength={40} defaultValue={String(state.values?.lenderKey ?? "")} />
          )}
        </FormField>
        <FormField id="environment" label="Environment" required>
          {(a11y) => (
            <NativeSelect {...a11y} name="environment" defaultValue="sandbox">
              <option value="sandbox">Sandbox (test keys)</option>
              <option value="live">Live</option>
            </NativeSelect>
          )}
        </FormField>
      </div>
      <p className="text-footnote text-ink-subtle">
        A partner can do nothing until it has an approved key. Its key, environment and lender config can&rsquo;t be
        changed later.
      </p>
      <div>
        <SubmitButton>Add partner</SubmitButton>
      </div>
    </form>
  );
}

export function IssueKeyForm({
  partnerId,
  activeKeys,
}: {
  partnerId: string;
  activeKeys: { id: string; label: string; prefix: string }[];
}) {
  const [state, action] = useActionState(proposeKeyAction, initialFormState as SecretFormState);
  const [replaces, setReplaces] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <OneTimeSecret state={state} />
      <input type="hidden" name="partnerId" value={partnerId} />
      <FormField id="label" label="Label" required description="What it's for, e.g. “Decision service (prod)”.">
        {(a11y) => <Input {...a11y} name="label" maxLength={80} autoComplete="off" />}
      </FormField>
      <ChoiceFieldset id="scopes" legend="Scopes" required>
        {PARTNER_SCOPES.map((s) => (
          <CheckboxRow key={s} name="scopes" value={s} defaultChecked label={s} description={PARTNER_SCOPE_LABELS[s]} />
        ))}
      </ChoiceFieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="lifetimeDays" label="Expires after" required>
          {(a11y) => (
            <NativeSelect {...a11y} name="lifetimeDays" defaultValue={String(DEFAULT_KEY_LIFETIME_DAYS)}>
              {KEY_LIFETIME_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {activeKeys.length ? (
          <FormField id="replacesKeyId" label="Replaces (rotation)">
            {(a11y) => (
              <NativeSelect
                {...a11y}
                name="replacesKeyId"
                value={replaces}
                onChange={(e) => setReplaces(e.target.value)}
              >
                <option value="">Nothing — an additional key</option>
                {activeKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label} · {k.prefix}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        {replaces ? (
          <FormField id="overlapHours" label="Old key keeps working for" required>
            {(a11y) => (
              <NativeSelect {...a11y} name="overlapHours" defaultValue="24">
                {ROTATION_OVERLAP_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? "No overlap" : `${h} hours after approval`}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
      </div>
      <p className="text-footnote text-ink-subtle">
        Shown once, to you. Works only after a second ops admin approves it. Only a hash is stored.
      </p>
      <div>
        <SubmitButton>Issue key</SubmitButton>
      </div>
    </form>
  );
}

export function DecideForm({
  kind,
  partnerId,
  id,
  own,
}: {
  kind: "key" | "webhook";
  partnerId: string;
  id: string;
  own: boolean;
}) {
  const [state, action] = useActionState(kind === "key" ? decideKeyAction : decideWebhookAction, initialFormState);
  if (own)
    return (
      <form action={kind === "key" ? cancelKeyAction : cancelWebhookAction} className="flex flex-col gap-2">
        <p className="text-footnote text-ink-subtle">You proposed this — another ops admin must approve it.</p>
        <input type="hidden" name="partnerId" value={partnerId} />
        <input type="hidden" name={kind === "key" ? "keyId" : "endpointId"} value={id} />
        <div>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Cancelling…">
            Cancel it
          </SubmitButton>
        </div>
      </form>
    );
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name={kind === "key" ? "keyId" : "endpointId"} value={id} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approve" size="sm" pendingLabel="Approving…">
          Approve
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="destructive" size="sm" pendingLabel="Rejecting…">
          Reject
        </SubmitButton>
      </div>
    </form>
  );
}

export function RevokeKeyForm({ partnerId, keyId, label }: { partnerId: string; keyId: string; label: string }) {
  const [state, action] = useActionState(revokeKeyAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="keyId" value={keyId} />
      <label htmlFor={`revoke-${keyId}`} className="sr-only">
        Reason for revoking {label}
      </label>
      <Input id={`revoke-${keyId}`} name="reason" placeholder="Reason (required)" maxLength={500} />
      <div>
        <SubmitButton variant="destructive" size="sm" pendingLabel="Revoking…">
          Revoke now
        </SubmitButton>
      </div>
    </form>
  );
}

export function WebhookForm({
  partnerId,
  hasActive,
  locked,
}: {
  partnerId: string;
  hasActive: boolean;
  /** A URL is waiting for approval: no new proposal until it's decided. */
  locked: boolean;
}) {
  const [state, action] = useActionState(proposeWebhookAction, initialFormState as SecretFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <OneTimeSecret state={state} />
      {locked ? (
        <p className="text-footnote text-ink-subtle">A URL is waiting for a second ops admin. Decide it first.</p>
      ) : (
        <>
          <input type="hidden" name="partnerId" value={partnerId} />
          <FormField
            id="url"
            label={hasActive ? "New webhook URL" : "Webhook URL"}
            required
            description="HTTPS. Receives thin, signed events (ids only). Needs a second ops admin."
          >
            {(a11y) => (
              <Input
                {...a11y}
                name="url"
                type="url"
                maxLength={500}
                placeholder="https://partner.example/webhooks/creatorco"
                defaultValue={String(state.values?.url ?? "")}
              />
            )}
          </FormField>
          <div>
            <SubmitButton variant="secondary">Propose URL</SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}

export function EndpointActions({ partnerId, endpointId }: { partnerId: string; endpointId: string }) {
  const [rotateState, rotate] = useActionState(rotateSecretAction, initialFormState as SecretFormState);
  const [retireState, retire] = useActionState(retireWebhookAction, initialFormState);
  return (
    <div className="flex flex-col gap-3">
      <FormMessage state={rotateState} />
      <FormMessage state={retireState} />
      <OneTimeSecret state={rotateState} />
      <div className="flex flex-wrap gap-2">
        <form action={rotate}>
          <input type="hidden" name="partnerId" value={partnerId} />
          <input type="hidden" name="endpointId" value={endpointId} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Rotating…">
            Rotate signing secret
          </SubmitButton>
        </form>
        <form action={retire}>
          <input type="hidden" name="partnerId" value={partnerId} />
          <input type="hidden" name="endpointId" value={endpointId} />
          <SubmitButton variant="destructive" size="sm" pendingLabel="Retiring…">
            Stop deliveries
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

export function PartnerStatusForm({ partnerId, status }: { partnerId: string; status: "active" | "suspended" }) {
  const [state, action] = useActionState(setPartnerStatusAction, initialFormState);
  const next = status === "active" ? "suspended" : "active";
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="status" value={next} />
      <p className="text-footnote text-ink-subtle">
        {next === "suspended"
          ? "Blocks every key and pauses webhooks at once. Events keep accumulating in the partner's feed."
          : "Approved keys work again and queued webhooks resume."}
      </p>
      <label htmlFor="status-reason" className="sr-only">
        Reason
      </label>
      <Input id="status-reason" name="reason" placeholder="Reason (required)" maxLength={500} />
      <div>
        <SubmitButton variant={next === "suspended" ? "destructive" : "secondary"} size="sm">
          {next === "suspended" ? "Suspend partner" : "Reactivate partner"}
        </SubmitButton>
      </div>
    </form>
  );
}
