"use client";

import { useActionState, useId } from "react";

import { CheckboxRow, FormField, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { fieldClasses, Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { initialFormState, type FormState } from "@/lib/forms";

import { decideChangeAction, proposeChangeAction } from "../actions";

/** Client forms for the /ops console. Every change carries a reason (kept on the request and audited). */

function ReasonField({ state, placeholder }: { state: FormState; placeholder: string }) {
  const id = `reason-${useId().replace(/:/g, "")}`;
  return (
    <FormField id={id} label="Reason" required errors={state.fieldErrors?.reason}>
      {(a11y) => (
        <textarea
          {...a11y}
          name="reason"
          rows={2}
          required
          defaultValue={String(state.values?.reason ?? "")}
          placeholder={placeholder}
          className={cn(fieldClasses, "h-auto py-3")}
        />
      )}
    </FormField>
  );
}

function ApprovalNote({ needsApproval }: { needsApproval: boolean }) {
  return (
    <p className="text-footnote leading-snug text-ink-subtle">
      {needsApproval
        ? "Needs approval from a second ops admin before it takes effect."
        : "Takes effect immediately and is recorded."}
    </p>
  );
}

export interface ConfigOption {
  id: string;
  key: string;
  mode: string;
  enabled: boolean;
}

export function RouteForm({
  kind,
  configs,
  primaryConfigId,
  fallbackConfigId,
}: {
  kind: string;
  configs: ConfigOption[];
  primaryConfigId: string | null;
  fallbackConfigId: string | null;
}) {
  const [state, action] = useActionState(proposeChangeAction, initialFormState);
  const usable = configs.filter((c) => c.enabled);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="action" value="set_route" />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="primaryConfigId" label="Primary" required>
          {(a11y) => (
            <NativeSelect {...a11y} name="primaryConfigId" defaultValue={primaryConfigId ?? ""}>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.key} · {c.mode}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="fallbackConfigId" label="Fallback" description="Serves while the primary's circuit is open.">
          {(a11y) => (
            <NativeSelect {...a11y} name="fallbackConfigId" defaultValue={fallbackConfigId ?? ""}>
              <option value="">None</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.key} · {c.mode}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <ReasonField state={state} placeholder="e.g. Move to the sandbox adapter for UAT" />
      <ApprovalNote needsApproval />
      <div>
        <SubmitButton pendingLabel="Submitting…">Request route change</SubmitButton>
      </div>
    </form>
  );
}

export function KillSwitchForm({ kind, paused, label }: { kind: string; paused: boolean; label: string }) {
  const [state, action] = useActionState(proposeChangeAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="action" value={paused ? "resume_kind" : "pause_kind"} />
      <input type="hidden" name="kind" value={kind} />
      <ReasonField
        state={state}
        placeholder={paused ? "e.g. Vendor confirmed the incident is resolved" : "e.g. Vendor returning wrong data"}
      />
      <ApprovalNote needsApproval={paused} />
      <div>
        <SubmitButton variant={paused ? "secondary" : "destructive"} pendingLabel="Submitting…">
          {paused ? `Request to resume ${label}` : `Pause all ${label} calls now`}
        </SubmitButton>
      </div>
    </form>
  );
}

export interface AdapterOption {
  adapter: string;
  label: string;
  modes: readonly string[];
  secrets: readonly string[];
}

export function ConfigForm({
  kind,
  adapters,
  config,
}: {
  kind: string;
  adapters: AdapterOption[];
  /** Present when editing. */
  config?: {
    id: string;
    key: string;
    adapter: string;
    mode: string;
    enabled: boolean;
    settings: Record<string, unknown>;
    secretRefs: Record<string, string>;
    routed: boolean;
  };
}) {
  const [state, action] = useActionState(proposeChangeAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const editing = Boolean(config);
  const prefix = config ? `cfg-${config.id.slice(0, 8)}-` : "new-";
  const adapter = adapters.find((a) => a.adapter === config?.adapter) ?? adapters[0];
  const modes = adapter?.modes ?? ["mock"];
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="action" value={editing ? "update_config" : "create_config"} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="returnKind" value={kind} />
      {config ? <input type="hidden" name="configId" value={config.id} /> : null}
      {!editing ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={`${prefix}key`}
            label="Key"
            required
            description="Vendor-neutral, recorded with data this config produces. Can't be changed later."
            errors={e.key}
          >
            {(a11y) => <Input {...a11y} name="key" placeholder="bureau_b" autoComplete="off" />}
          </FormField>
          <FormField id={`${prefix}adapter`} label="Adapter" required errors={e.adapter}>
            {(a11y) => (
              <NativeSelect {...a11y} name="adapter" defaultValue={adapter?.adapter}>
                {adapters.map((a) => (
                  <option key={a.adapter} value={a.adapter}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
      ) : null}
      <FormField id={`${prefix}mode`} label="Mode" required errors={e.mode}>
        {(a11y) => (
          <NativeSelect {...a11y} name="mode" defaultValue={config?.mode ?? modes[0]}>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id={`${prefix}settings`}
        label="Settings (JSON)"
        description="Non-secret options only; unknown keys are rejected. Mocks accept timeoutMs and simulateOutage."
        errors={e.settings}
        optionalLabel={false}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            name="settings"
            rows={3}
            spellCheck={false}
            defaultValue={String(state.values?.settings ?? JSON.stringify(config?.settings ?? {}, null, 0))}
            className={cn(fieldClasses, "h-auto py-3 font-mono text-[15px]")}
          />
        )}
      </FormField>
      <FormField
        id={`${prefix}secretRefs`}
        label="Secret references"
        description={
          adapter?.secrets.length
            ? `One per line: name=INTEGRATION_ENV_VAR. Needs: ${adapter.secrets.join(", ")}. Values stay in the hosting secret store.`
            : "This adapter needs no secrets."
        }
        errors={e.secretRefs}
        optionalLabel={false}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            name="secretRefs"
            rows={2}
            spellCheck={false}
            defaultValue={Object.entries(config?.secretRefs ?? {})
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")}
            className={cn(fieldClasses, "h-auto py-3 font-mono text-[15px]")}
          />
        )}
      </FormField>
      <CheckboxRow name="enabled" label="Enabled" defaultChecked={config?.enabled ?? false} />
      <ReasonField
        state={state}
        placeholder={editing ? "e.g. Raise the timeout to 15s" : "e.g. Second bureau for failover"}
      />
      <ApprovalNote needsApproval={editing ? config!.routed || config!.mode !== "mock" : modes[0] !== "mock"} />
      <div>
        <SubmitButton pendingLabel="Submitting…">{editing ? "Submit change" : "Create config"}</SubmitButton>
      </div>
    </form>
  );
}

export function DecisionForm({ requestId, ownRequest }: { requestId: string; ownRequest: boolean }) {
  const [state, action] = useActionState(decideChangeAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor={`note-${requestId}`} className="sr-only">
        Decision note
      </label>
      <Input id={`note-${requestId}`} name="note" placeholder="Note (optional)" maxLength={500} />
      <div className="flex flex-wrap gap-2">
        {ownRequest ? (
          <SubmitButton name="decision" value="reject" variant="secondary" size="sm" pendingLabel="Cancelling…">
            Cancel my request
          </SubmitButton>
        ) : (
          <>
            <SubmitButton name="decision" value="approve" size="sm" pendingLabel="Applying…">
              Approve and apply
            </SubmitButton>
            <SubmitButton name="decision" value="reject" variant="destructive" size="sm" pendingLabel="Rejecting…">
              Reject
            </SubmitButton>
          </>
        )}
      </div>
      {ownRequest ? (
        <p className="text-footnote text-ink-subtle">
          You requested this change, so another ops admin must approve it.
        </p>
      ) : null}
    </form>
  );
}
