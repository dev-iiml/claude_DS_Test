"use client";

import { useActionState, useState } from "react";

import { ChoiceFieldset, FormField, FormMessage, RadioRow } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";

import { raiseQueryAction, releaseProposalAction, reviewDecisionAction, withdrawQueryAction } from "../actions";

export function ReleaseForm({ proposalId }: { proposalId: string }) {
  const [state, action] = useActionState(releaseProposalAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <FormField id="reason" label="Why is it safe to send?" description="Recorded with your name. 3–500 characters.">
        {(a11y) => <Input {...a11y} name="reason" maxLength={500} autoComplete="off" />}
      </FormField>
      <div>
        <SubmitButton>Release and send</SubmitButton>
      </div>
    </form>
  );
}

export function ReviewForm({
  proposalId,
  decision,
  actions,
}: {
  proposalId: string;
  decision: { id: string; outcome: string; exposure: number | null; tenorMonths: number | null };
  /** `confirm`+`override` for the simulated lender; `confirm`+`query` for a partner lender (Stage 12b). */
  actions: readonly ("confirm" | "override" | "query")[];
}) {
  const [reviewState, reviewAction] = useActionState(reviewDecisionAction, initialFormState);
  const [queryState, queryAction] = useActionState(raiseQueryAction, initialFormState);
  const [mode, setMode] = useState<"confirm" | "override" | "query">("confirm");
  const [outcome, setOutcome] = useState(decision.outcome);
  const state = mode === "query" ? queryState : reviewState;
  return (
    <form action={mode === "query" ? queryAction : reviewAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="proposalId" value={proposalId} />
      {/* The revision on screen: confirming after a newer one arrived is refused. */}
      <input type="hidden" name="decisionId" value={decision.id} />
      <ChoiceFieldset id="action" legend="Your review" required>
        <RadioRow
          name="action"
          value="confirm"
          label="Confirm the lender's decision"
          description="The creator sees it as received."
          checked={mode === "confirm"}
          onChange={() => setMode("confirm")}
        />
        {actions.includes("override") ? (
          <RadioRow
            name="action"
            value="override"
            label="Override it"
            description="Simulated lender only. Set the final outcome yourself, with a reason — never more favourable."
            checked={mode === "override"}
            onChange={() => setMode("override")}
          />
        ) : null}
        {actions.includes("query") ? (
          <RadioRow
            name="action"
            value="query"
            label="Raise a query with the partner"
            description="The partner lender's decision is its own sanction — CreatorCo can't change it. Ask the partner to look again; it answers with a revised or reaffirmed decision."
            checked={mode === "query"}
            onChange={() => setMode("query")}
          />
        ) : null}
      </ChoiceFieldset>
      {mode === "override" ? (
        <>
          <ChoiceFieldset id="outcome" legend="Final outcome" required>
            {[
              ["approved", "Approved"],
              ["modified", "Approved with changes"],
              ["declined", "Not approved"],
            ].map(([v, l]) => (
              <RadioRow
                key={v}
                name="outcome"
                value={v}
                label={l}
                checked={outcome === v}
                onChange={() => setOutcome(v!)}
              />
            ))}
          </ChoiceFieldset>
          {outcome !== "declined" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="exposure" label="Amount (₹)" description="₹10,000 – ₹25,00,000">
                {(a11y) => (
                  <Input {...a11y} name="exposure" inputMode="numeric" defaultValue={decision.exposure ?? ""} />
                )}
              </FormField>
              <FormField id="tenorMonths" label="Tenor (months)" description="3–60">
                {(a11y) => (
                  <Input {...a11y} name="tenorMonths" inputMode="numeric" defaultValue={decision.tenorMonths ?? ""} />
                )}
              </FormField>
            </div>
          ) : null}
        </>
      ) : null}
      {mode === "query" ? (
        <FormField
          id="message"
          label="Message to the partner lender"
          required
          description="Sent to the partner as written (10–500 characters). Don't include anything the creator didn't agree to share."
        >
          {(a11y) => <Input {...a11y} name="message" maxLength={500} autoComplete="off" />}
        </FormField>
      ) : (
        <FormField
          id="reason"
          label={mode === "override" ? "Reason for the override" : "Note"}
          required={mode === "override"}
          description={
            mode === "override" ? "Required, 10–500 characters. Recorded with your name." : "Recorded with your name."
          }
        >
          {(a11y) => <Input {...a11y} name="reason" maxLength={500} autoComplete="off" />}
        </FormField>
      )}
      <div>
        <SubmitButton>
          {mode === "override" ? "Save override" : mode === "query" ? "Send query" : "Confirm decision"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function WithdrawQueryForm({ proposalId }: { proposalId: string }) {
  const [state, action] = useActionState(withdrawQueryAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <FormField
        id="withdraw-reason"
        label="Withdraw the query"
        description="If the partner can't answer (unresponsive or suspended). The decision then stands as posted and can be confirmed. Recorded with your name, 10–500 characters; not sent to the partner."
      >
        {(a11y) => <Input {...a11y} name="reason" maxLength={500} autoComplete="off" />}
      </FormField>
      <div>
        <SubmitButton variant="secondary">Withdraw query</SubmitButton>
      </div>
    </form>
  );
}
