import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink, ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getOwnSocialAccount } from "@/modules/social-data/queries";

import { requireMember } from "@/app/_lib/member";
import { CreatorShell } from "@/app/_components/creator-shell";
import { PageTitle } from "@/app/_components/page-title";

import { disconnectAccountAction, makePrimaryAccountAction } from "../../connect-actions";

export const metadata: Metadata = { title: "Connected account" };

const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export default async function AccountDetailPage({ params }: PageProps<"/passport/accounts/[id]">) {
  const { id } = await params;
  const { user, passport } = await requireMember();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const account = await getOwnSocialAccount(getDb(), { userId: user.userId, accountId: id });
  if (!account || account.status !== "connected") notFound();
  const differs = account.declaredHandle && account.declaredHandle.toLowerCase() !== account.handle.toLowerCase();

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageTitle
        title={account.platformLabel}
        description={`@${account.handle}${account.otherAccountsOnPlatform && account.isPrimary ? " · primary account" : ""}`}
        status={<StatusBadge tone="success">Connected</StatusBadge>}
      />

      <div className="flex max-w-2xl flex-col gap-8">
        <ListGroup id="details" label="Account">
          <ListRow label="Handle" value={`@${account.handle}`} />
          {account.declaredHandle ? (
            <ListRow
              label="You declared"
              value={`@${account.declaredHandle}`}
              detail={differs ? "Differs from the connected handle" : undefined}
            />
          ) : null}
          {account.accountCreatedAt ? (
            <ListRow label="On the platform since" value={date.format(account.accountCreatedAt)} />
          ) : null}
          {account.connectedAt ? <ListRow label="Connected" value={date.format(account.connectedAt)} /> : null}
        </ListGroup>

        <ListGroup
          id="metrics"
          label="Latest metrics"
          footer={`${account.historyMonths} monthly snapshot${account.historyMonths === 1 ? "" : "s"} stored.`}
        >
          <ListRow
            label={account.latest?.audienceLabel ?? "Audience"}
            value={account.latest?.audience != null ? compact.format(account.latest.audience) : "—"}
          />
          <ListRow
            label="Engagement"
            value={
              account.latest?.engagementRate != null ? `${(account.latest.engagementRate * 100).toFixed(1)}%` : "—"
            }
          />
          {account.latest ? <ListRow label="As of" value={date.format(account.latest.capturedAt)} /> : null}
        </ListGroup>

        {!passport.consents.professionalAnalytics ? (
          <ListGroup
            id="signals"
            label="Professional signals"
            footer="Optional and separate. Not a credit score. Turn off any time in Account › Consents."
          >
            <ListRow
              href="/passport/signals"
              label="See how your creator business is trending"
              detail="Turn on signals to add longevity, consistency and platform mix to your Passport — and to be considered for Onyx and Icon."
            />
          </ListGroup>
        ) : null}

        {account.otherAccountsOnPlatform && !account.isPrimary ? (
          <form action={makePrimaryAccountAction} className="flex flex-col gap-2">
            <input type="hidden" name="accountId" value={account.id} />
            <Button type="submit" variant="secondary" size="lg" className="w-full sm:w-auto">
              Make this my primary {account.platformLabel} account
            </Button>
            <p className="text-footnote text-ink-subtle">
              Your primary account is shown first on your Passport. All connected accounts count towards your
              professional signals.
            </p>
          </form>
        ) : null}

        {/* Two steps: disconnecting stops reading the account and removes its stored metrics. */}
        <details className="group flex flex-col gap-2">
          <summary className="w-fit cursor-pointer list-none rounded-control text-body font-medium text-danger [&::-webkit-details-marker]:hidden">
            Disconnect {account.platformLabel}…
          </summary>
          <form action={disconnectAccountAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="accountId" value={account.id} />
            <p className="text-subhead text-ink-muted">
              We&rsquo;ll stop reading this account. If you declared it, it stays on your Passport as self-declared.
            </p>
            <Button type="submit" variant="destructive" size="lg" className="w-full sm:w-auto">
              Yes, disconnect {account.platformLabel}
            </Button>
          </form>
        </details>
      </div>
    </CreatorShell>
  );
}
