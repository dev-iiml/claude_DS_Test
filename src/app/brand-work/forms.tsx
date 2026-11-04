"use client";

import { useActionState } from "react";

import { FormField, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { initialFormState } from "@/lib/forms";

import {
  createBrandAction,
  decideMergeAction,
  decideReversalAction,
  directoryEditAction,
  negativeDecisionAction,
  paymentConfirmationAction,
  proposeReversalAction,
  resolveBrandAction,
  verifyAction,
} from "./actions";

type Option = { value: string; label: string };

function Reasons({ reasons, label = "Reason" }: { reasons: Option[]; label?: string }) {
  return (
    <FormField id="reasonCode" label={label} required>
      {(a11y) => (
        <NativeSelect {...a11y} name="reasonCode" defaultValue="" className="sm:max-w-sm">
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
  );
}

const NOTE_HINT = "Staff only. No identifiers — no numbers, e-mail addresses or phone numbers.";

export function ResolveBrandForm({
  recordId,
  brands,
  industries,
  suggestedIndustry,
  currentBrandId,
}: {
  recordId: string;
  brands: Option[];
  industries: Option[];
  suggestedIndustry: string | null;
  currentBrandId: string | null;
}) {
  const [state, action] = useActionState(resolveBrandAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="recordId" value={recordId} />
      <FormField id="directoryId" label="Brand in the directory">
        {(a11y) => (
          <NativeSelect {...a11y} name="directoryId" defaultValue={currentBrandId ?? ""}>
            <option value="">— Add a new brand below —</option>
            {brands.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="newBrandName" label="Or add a new brand" description="As the brand writes its name.">
        {(a11y) => <Input {...a11y} name="newBrandName" maxLength={80} autoComplete="off" />}
      </FormField>
      <FormField id="industryCode" label="Industry" required>
        {(a11y) => (
          <NativeSelect {...a11y} name="industryCode" defaultValue={suggestedIndustry ?? ""} className="sm:max-w-sm">
            <option value="" disabled>
              Choose an industry
            </option>
            {industries.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Confirm brand and industry
        </SubmitButton>
      </div>
    </form>
  );
}

export function VerifyForm({ recordId, secondReview }: { recordId: string; secondReview: boolean }) {
  const [state, action] = useActionState(verifyAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="recordId" value={recordId} />
      {secondReview ? null : (
        <FormField
          id="counterparties"
          label="Billed party on each document"
          description="Optional: the name each document is billed to, comma-separated. Different names raise a flag for a second reviewer."
        >
          {(a11y) => <Input {...a11y} name="counterparties" maxLength={400} autoComplete="off" />}
        </FormField>
      )}
      <FormField id="note" label="Note" description={NOTE_HINT}>
        {(a11y) => <Input {...a11y} name="note" maxLength={280} autoComplete="off" />}
      </FormField>
      <div>
        <SubmitButton pendingLabel="Saving…">{secondReview ? "Complete second review" : "Verify"}</SubmitButton>
      </div>
    </form>
  );
}

export function NegativeDecisionForm({ recordId, reasons }: { recordId: string; reasons: Option[] }) {
  const [state, action] = useActionState(negativeDecisionAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="recordId" value={recordId} />
      <Reasons reasons={reasons} />
      <FormField id="decision-note" label="Note" description={NOTE_HINT}>
        {(a11y) => <Input {...a11y} name="note" maxLength={280} autoComplete="off" />}
      </FormField>
      <p className="text-footnote text-ink-subtle">
        The creator sees only a neutral message for the reason — never your note.
      </p>
      <div className="flex flex-wrap gap-3">
        <SubmitButton name="decision" value="request_info" variant="secondary" pendingLabel="Saving…">
          Ask for a change
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="destructive" pendingLabel="Saving…">
          Don&apos;t verify
        </SubmitButton>
      </div>
    </form>
  );
}

export function PaymentConfirmationForm({ recordId, hasRemittance }: { recordId: string; hasRemittance: boolean }) {
  const [state, action] = useActionState(paymentConfirmationAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="recordId" value={recordId} />
      <FormField id="method" label="How it was confirmed" required>
        {(a11y) => (
          <NativeSelect {...a11y} name="method" defaultValue="agency_confirmation" className="sm:max-w-sm">
            <option value="agency_confirmation">The agency or brand confirmed it</option>
            <option value="remittance_advice" disabled={!hasRemittance}>
              Remittance advice on the record{hasRemittance ? "" : " (none uploaded)"}
            </option>
          </NativeSelect>
        )}
      </FormField>
      <FormField id="month" label="Month the payment arrived" required>
        {(a11y) => <Input {...a11y} type="month" name="month" className="sm:max-w-xs" />}
      </FormField>
      <FormField id="pay-note" label="Agency contact / how you checked" description={NOTE_HINT}>
        {(a11y) => (
          <Input
            {...a11y}
            name="note"
            maxLength={280}
            autoComplete="off"
            placeholder="e.g. Confirmed with the agency's finance team"
          />
        )}
      </FormField>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Confirm payment
        </SubmitButton>
      </div>
    </form>
  );
}

export function ProposeReversalForm({ recordId, reasons }: { recordId: string; reasons: Option[] }) {
  const [state, action] = useActionState(proposeReversalAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="recordId" value={recordId} />
      <Reasons reasons={reasons} label="Why reverse it?" />
      <p className="text-footnote text-ink-subtle">
        Another reviewer approves it. Approval un-verifies the record and reverses any milestone points it no longer
        supports.
      </p>
      <div>
        <SubmitButton variant="destructive" pendingLabel="Saving…">
          Propose reversal
        </SubmitButton>
      </div>
    </form>
  );
}

export function DecideReversalForm({ reversalId, recordId }: { reversalId: string; recordId: string }) {
  const [state, action] = useActionState(decideReversalAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="reversalId" value={reversalId} />
      <input type="hidden" name="recordId" value={recordId} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton name="decision" value="approve" variant="destructive" size="sm" pendingLabel="Saving…">
          Approve reversal
        </SubmitButton>
        <SubmitButton name="decision" value="decline" variant="secondary" size="sm" pendingLabel="Saving…">
          Decline
        </SubmitButton>
      </div>
    </form>
  );
}

export function CreateBrandForm({ industries }: { industries: Option[] }) {
  const [state, action] = useActionState(createBrandAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <FormField id="name" label="Brand name" required>
        {(a11y) => <Input {...a11y} name="name" maxLength={80} autoComplete="off" />}
      </FormField>
      <FormField id="new-industry" label="Industry" required>
        {(a11y) => (
          <NativeSelect {...a11y} name="industryCode" defaultValue="" className="sm:max-w-sm">
            <option value="" disabled>
              Choose an industry
            </option>
            {industries.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Add brand
        </SubmitButton>
      </div>
    </form>
  );
}

export function DirectoryEditForm({
  directoryId,
  industries,
  brands,
  industry,
}: {
  directoryId: string;
  industries: Option[];
  brands: Option[];
  industry: string;
}) {
  const [state, action] = useActionState(directoryEditAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3 pt-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="directoryId" value={directoryId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-ink-muted">Add an alias</span>
          <Input name="alias" maxLength={80} autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-ink-muted">Industry</span>
          <NativeSelect name="industryCode" defaultValue={industry}>
            {industries.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-ink-muted">Propose merging into</span>
          <NativeSelect name="mergeInto" defaultValue="">
            <option value="">—</option>
            {brands
              .filter((b) => b.value !== directoryId)
              .map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
          </NativeSelect>
        </label>
      </div>
      <div>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

export function DecideMergeForm({ mergeId }: { mergeId: string }) {
  const [state, action] = useActionState(decideMergeAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="mergeId" value={mergeId} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton name="decision" value="approve" size="sm" pendingLabel="Saving…">
          Approve merge
        </SubmitButton>
        <SubmitButton name="decision" value="decline" variant="secondary" size="sm" pendingLabel="Saving…">
          Decline
        </SubmitButton>
      </div>
    </form>
  );
}
