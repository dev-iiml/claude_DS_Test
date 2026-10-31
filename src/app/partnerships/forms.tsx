"use client";

import { useActionState, useState } from "react";

import { CheckboxRow, ChoiceFieldset, FormField, FormMessage, RadioRow } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { fieldClasses, Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { initialFormState } from "@/lib/forms";
import { ACCESS_DECLINE_REASONS, MAX_POINTS_COST, MAX_SEATS, OPPORTUNITY_KINDS } from "@/modules/access/domain";
import {
  ACCESS_DECLINE_REASON_LABELS,
  OPPORTUNITY_KIND_LABELS,
  tierRequirementLabel,
} from "@/modules/access/presentation";
import { CREATOR_STATUS_TIERS } from "@/modules/creator-status/status";

import {
  closeOpportunityAction,
  createOpportunityAction,
  completeRequestAction,
  decideRequestAction,
  updateOpportunityAction,
} from "./actions";

/** Client forms for the partnerships desk. */

export interface OpportunityFormValues {
  id?: string;
  brandId: string;
  title: string;
  kind: string;
  category: string;
  summary: string;
  details: string;
  minTier: string;
  pointsCost: string;
  seats: string;
  /** IST local datetime, "YYYY-MM-DDTHH:mm". */
  opensAt: string;
  closesAt: string;
  status: string;
}

export function OpportunityForm({
  brands,
  initial,
}: {
  brands: { id: string; name: string }[];
  initial: OpportunityFormValues;
}) {
  const [state, action] = useActionState(
    initial.id ? updateOpportunityAction : createOpportunityAction,
    initialFormState,
  );
  const e = state.fieldErrors ?? {};
  const v = (k: keyof OpportunityFormValues) => String(state.values?.[k] ?? initial[k] ?? "");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="brandId" label="Brand" required errors={e.brandId}>
          {(a11y) => (
            <NativeSelect {...a11y} name="brandId" defaultValue={v("brandId")}>
              <option value="">Choose…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="kind" label="Kind" required errors={e.kind}>
          {(a11y) => (
            <NativeSelect {...a11y} name="kind" defaultValue={v("kind")}>
              {OPPORTUNITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {OPPORTUNITY_KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="title" label="Title" required errors={e.title}>
          {(a11y) => <Input {...a11y} name="title" maxLength={80} defaultValue={v("title")} />}
        </FormField>
        <FormField id="category" label="Category" required errors={e.category}>
          {(a11y) => <Input {...a11y} name="category" maxLength={60} defaultValue={v("category")} />}
        </FormField>
      </div>
      <FormField id="summary" label="Summary" required description="One line, shown on the card." errors={e.summary}>
        {(a11y) => <Input {...a11y} name="summary" maxLength={200} defaultValue={v("summary")} />}
      </FormField>
      <FormField id="details" label="Details" required errors={e.details}>
        {(a11y) => (
          <textarea
            {...a11y}
            name="details"
            rows={5}
            maxLength={2000}
            defaultValue={v("details")}
            className={cn(fieldClasses, "h-auto py-3")}
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="minTier" label="Who can request" required errors={e.minTier}>
          {(a11y) => (
            <NativeSelect {...a11y} name="minTier" defaultValue={v("minTier")}>
              {CREATOR_STATUS_TIERS.map((t) => (
                <option key={t} value={t}>
                  {tierRequirementLabel(t)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="pointsCost" label="Creator Points" required errors={e.pointsCost}>
          {(a11y) => (
            <Input
              {...a11y}
              name="pointsCost"
              type="number"
              min={0}
              max={MAX_POINTS_COST}
              defaultValue={v("pointsCost")}
            />
          )}
        </FormField>
        <FormField id="seats" label="Places" required errors={e.seats}>
          {(a11y) => <Input {...a11y} name="seats" type="number" min={1} max={MAX_SEATS} defaultValue={v("seats")} />}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="opensAt" label="Requests open (IST)" required errors={e.opensAt}>
          {(a11y) => <Input {...a11y} name="opensAt" type="datetime-local" defaultValue={v("opensAt")} />}
        </FormField>
        <FormField id="closesAt" label="Requests close (IST)" required errors={e.closesAt}>
          {(a11y) => <Input {...a11y} name="closesAt" type="datetime-local" defaultValue={v("closesAt")} />}
        </FormField>
        <FormField id="status" label="Visibility" required errors={e.status}>
          {(a11y) => (
            <NativeSelect {...a11y} name="status" defaultValue={v("status")}>
              <option value="draft">Draft (staff only)</option>
              <option value="live">Live</option>
            </NativeSelect>
          )}
        </FormField>
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">{initial.id ? "Save changes" : "Create opportunity"}</SubmitButton>
      </div>
    </form>
  );
}

export function CloseOpportunityForm({ id }: { id: string }) {
  const [state, action] = useActionState(closeOpportunityAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Closing…">
          Close to new requests
        </SubmitButton>
      </div>
    </form>
  );
}

export function DecideRequestForm({ requestId, canApprove = true }: { requestId: string; canApprove?: boolean }) {
  const [state, action] = useActionState(decideRequestAction, initialFormState);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-6">
      <FormMessage state={state} />
      {canApprove ? (
        <form action={action}>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="approve" />
          <SubmitButton pendingLabel="Approving…">Approve request</SubmitButton>
        </form>
      ) : null}
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="decision" value="decline" />
        <ChoiceFieldset
          id="decline-reason"
          legend="Decline — reason shown to the creator"
          errors={state.fieldErrors?.reason}
          required
        >
          {ACCESS_DECLINE_REASONS.map((r) => (
            <RadioRow
              key={r}
              name="reason"
              value={r}
              label={ACCESS_DECLINE_REASON_LABELS[r]}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
          ))}
        </ChoiceFieldset>
        <div>
          <SubmitButton variant="secondary" pendingLabel="Declining…">
            Decline request
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

/** Marks an approved request as completed (attended / delivered). The creator earns the participation points once. */
export function CompleteRequestForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState(completeRequestAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="requestId" value={requestId} />
      <CheckboxRow
        name="confirm"
        label="The creator took part (attended or delivered)"
        aria-invalid={state.fieldErrors?.confirm ? true : undefined}
      />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Mark completed
        </SubmitButton>
      </div>
      <p className="text-footnote text-ink-subtle">
        The creator earns the Access participation points once. Points never depend on the opportunity&apos;s cost.
      </p>
    </form>
  );
}
