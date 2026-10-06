import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormField, Lede, PageHeading } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db";
import { listPlatforms } from "@/modules/creator-profile/queries";
import { requireCreator } from "@/modules/identity";
import { getPendingConnection } from "@/modules/social-data/connection-service";
import { getProviders } from "@/modules/integrations/registry";

export const metadata: Metadata = { title: "Test connection" };

const SCOPES = ["Public profile and handle", "Follower or subscriber counts", "Engagement and posting activity"];

/**
 * Stand-in for a platform's OAuth consent screen, used only while the mock
 * social provider is configured. A real provider shows its own screen.
 */
export default async function MockAuthorizePage({ searchParams }: PageProps<"/connect/mock">) {
  if ((await getProviders()).social.descriptor.mode !== "mock") notFound();
  const user = await requireCreator();
  const q = await searchParams;
  const state = typeof q.state === "string" ? q.state : "";
  const pending = state ? await getPendingConnection(getDb(), { userId: user.userId, state }) : null;
  const label = pending
    ? ((await listPlatforms(getDb())).find((p) => p.code === pending.platform)?.label ?? pending.platform)
    : null;

  return (
    <div className="flex min-h-dvh flex-col items-center bg-paper px-4 pt-safe pb-safe">
      <main id="main" className="flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-10">
        <p className="self-center rounded-full bg-warning-soft px-3 py-1 text-footnote font-medium text-warning">
          Test connection — simulated platform
        </p>

        {!pending || pending.used || pending.expired ? (
          <>
            <PageHeading>Link expired</PageHeading>
            <Lede>This connection link is no longer valid. Start again from your Passport.</Lede>
            <Button asChild variant="secondary">
              <Link href="/passport">Back to Passport</Link>
            </Button>
          </>
        ) : (
          <>
            <div>
              <p className="text-subhead text-ink-muted">{label}</p>
              <PageHeading className="mt-1">Allow CreatorCo to read your account?</PageHeading>
            </div>
            <ul className="flex flex-col gap-2 rounded-lg bg-surface p-4 text-subhead ring-1 ring-line ring-inset">
              {SCOPES.map((s) => (
                <li key={s} className="flex gap-2">
                  <span aria-hidden="true" className="text-success">
                    ✓
                  </span>
                  {s}
                </li>
              ))}
              <li className="flex gap-2 text-ink-muted">
                <span aria-hidden="true">✕</span>
                Posting, messages or your password
              </li>
            </ul>
            {q.invalid ? <Alert tone="danger">Enter a valid handle (letters, numbers, dots, dashes).</Alert> : null}
            <form action="/connect/mock/authorize" method="post" className="flex flex-col gap-5">
              <input type="hidden" name="state" value={state} />
              <FormField
                id="handle"
                label="Account handle"
                description="Test accounts: include “spike” for a sudden follower jump or “steady” for even growth."
                required
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    name="handle"
                    defaultValue={pending.declaredHandle ?? ""}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={64}
                  />
                )}
              </FormField>
              <div className="flex flex-col gap-3">
                <SubmitButton name="decision" value="allow" size="lg" pendingLabel="Connecting…">
                  Allow
                </SubmitButton>
                <Button type="submit" name="decision" value="cancel" variant="ghost" size="lg">
                  Cancel
                </Button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
