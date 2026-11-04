import Link from "next/link";
import type { Metadata } from "next";

import { AuthShell } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { getDb } from "@/db";
import { challengeEmail } from "@/modules/brand-orgs/signup-service";
import { getProviders } from "@/modules/integrations/registry";
import { MOCK_OTP_CODE } from "@/providers/notification/mock-notification-provider";

import { redirectIfSignedIn } from "../../../(auth)/redirect-if-signed-in";
import { BrandDetailsForm } from "../../forms";

export const metadata: Metadata = { title: "Your organisation" };

/** Public: brand sign-up, step 2 (email code, account and organisation details). */
export default async function BrandDetailsPage({ searchParams }: PageProps<"/brands/signup/details">) {
  await redirectIfSignedIn();
  const q = await searchParams;
  const challengeId = typeof q.c === "string" ? q.c : "";
  const email = await challengeEmail(getDb(), challengeId);
  if (!email)
    return (
      <AuthShell title="Code expired" description="That sign-up link has expired or was already used.">
        <Link href="/brands/signup" className="text-gold underline-offset-2 hover:underline">
          Start again
        </Link>
      </AuthShell>
    );
  const mock = (await getProviders()).notifications.descriptor.mode === "mock";
  return (
    <AuthShell
      title="Your organisation"
      description={`We sent a 6-digit code to ${email}. CreatorCo checks every organisation before it can unlock anything.`}
    >
      {mock ? (
        <Alert tone="info" className="mb-6">
          Demo mode — no email is sent. Use the code {MOCK_OTP_CODE}.
        </Alert>
      ) : null}
      <BrandDetailsForm challengeId={challengeId} />
    </AuthShell>
  );
}
