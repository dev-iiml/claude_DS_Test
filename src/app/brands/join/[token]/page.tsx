import type { Metadata } from "next";

import { AuthShell } from "@/components/creatorco";
import { getDb } from "@/db";
import { inviteFor } from "@/modules/brand-orgs/org-service";

import { redirectIfSignedIn } from "../../../(auth)/redirect-if-signed-in";
import { AcceptInviteForm } from "../../forms";

export const metadata: Metadata = { title: "Join your organisation", robots: { index: false, follow: false } };

/** Public: accept an invitation to a brand organisation (the token is the credential). */
export default async function JoinPage({ params }: PageProps<"/brands/join/[token]">) {
  await redirectIfSignedIn();
  const { token } = await params;
  const invite = await inviteFor(getDb(), token);
  if (!invite)
    return (
      <AuthShell title="Invitation expired" description="Ask your organisation's owner to send a new invitation.">
        {null}
      </AuthShell>
    );
  return (
    <AuthShell title={`Join ${invite.orgName}`} description={`Set a password for ${invite.email}.`}>
      <AcceptInviteForm token={token} />
    </AuthShell>
  );
}
