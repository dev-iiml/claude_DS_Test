"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { initialFormState } from "@/lib/forms";

import { shareWithOrgAction, type CodeFormState } from "../../passport/sharing/actions";

const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** Optional: give the brand's verified organisation — and only it — a one-off code to unlock your Passport. */
export function SharePassportWithOrg({ opportunityId, orgName }: { opportunityId: string; orgName: string }) {
  const [state, action] = useActionState<CodeFormState, FormData>(shareWithOrgAction, initialFormState);
  if (state.created)
    return (
      <Alert tone="success" title={`Code for ${orgName}`}>
        <p className="mt-1 font-mono text-title-3 tracking-wider select-all">{state.created.display}</p>
        <p className="mt-2">
          Copy it now — it won&apos;t be shown again. Send it to {orgName}&apos;s team yourself: it only works for their
          signed-in, verified members, until {dayMonth.format(new Date(state.created.expiresAt))}. You can revoke it in
          Sharing.
        </p>
      </Alert>
    );
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <p className="text-subhead text-ink-muted">
        {orgName} is verified on CreatorCo. If you like, create a code to send to its team — it only works for their
        signed-in members, for 7 days. Entirely optional — it doesn&apos;t affect your request.
      </p>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Creating…">
          Create a code for {orgName}
        </SubmitButton>
      </div>
    </form>
  );
}
