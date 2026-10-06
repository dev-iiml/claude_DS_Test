import type { Metadata } from "next";

import { BackLink, EmptyState, PageHeader } from "@/components/creatorco";

import { requireMember } from "@/app/_lib/member";
import { CreatorShell } from "@/app/_components/creator-shell";

import { ConnectForm } from "./connect-form";

export const metadata: Metadata = { title: "Connect an account" };

export default async function ConnectPage({ searchParams }: PageProps<"/passport/connect">) {
  const { passport } = await requireMember();
  const { platform, additional: additionalParam } = await searchParams;
  const requested = typeof platform === "string" ? platform : null;
  // "Add another account" lists platforms that already have one; otherwise platforms not yet connected.
  const additional = additionalParam === "1";
  const available = additional ? passport.addablePlatforms : passport.connectablePlatforms;
  const narrowed = requested ? available.filter((p) => p.code === requested) : [];
  const platforms = narrowed.length ? narrowed : available;
  const { connectionDefinition, analyticsDefinition, professionalAnalytics } = passport.consents;

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageHeader
        title={
          additional && narrowed.length === 1
            ? `Add another ${narrowed[0]!.label} account`
            : narrowed.length === 1
              ? `Connect ${narrowed[0]!.label}`
              : "Connect an account"
        }
        description={
          additional
            ? "Connect another account you run on this platform. Each account is verified separately and can be disconnected any time."
            : "Connecting verifies your creator activity. You'll confirm on the platform and can disconnect any time."
        }
      />
      <div className="max-w-2xl">
        {platforms.length === 0 || !connectionDefinition ? (
          <EmptyState
            title="Nothing to connect"
            description={
              additional
                ? "You've reached the number of accounts you can connect on this platform."
                : "All supported platforms on your Passport are already connected."
            }
          />
        ) : (
          <ConnectForm
            platforms={platforms}
            selected={requested}
            additional={additional}
            connectionConsent={connectionDefinition}
            analyticsConsent={analyticsDefinition}
            analyticsOn={professionalAnalytics}
          />
        )}
      </div>
    </CreatorShell>
  );
}
