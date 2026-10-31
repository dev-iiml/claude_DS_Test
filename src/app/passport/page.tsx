import Link from "next/link";
import type { Metadata } from "next";

import {
  CreatorStatusBadge,
  ListGroup,
  ListRow,
  MembershipCard,
  PageHeader,
  StatusBadge,
  VerificationMark,
} from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FEATURE_COPY, formatFeatureValue } from "@/modules/professional-graph/presentation";

import { requireMember } from "../_lib/member";
import { CreatorShell } from "../_components/creator-shell";
import { refreshAccountsAction } from "./connect-actions";
import { CONNECT_ERROR_COPY } from "./connect/constants";

export const metadata: Metadata = { title: "Creator Passport" };

const SUMMARY_SIGNALS = ["professional_longevity_months", "posting_consistency_12m", "engagement_stability"] as const;

const UPDATED_COPY: Record<string, string> = {
  about: "Your details were updated.",
  profile: "Your creator profile was updated.",
  business: "Your business details were updated.",
  interests: "Your interests were updated.",
};

const monthYear = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function notice(q: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  const err = one("connect_error");
  if (err)
    return {
      tone: err === "cancelled" ? ("neutral" as const) : ("danger" as const),
      text: CONNECT_ERROR_COPY[err] ?? CONNECT_ERROR_COPY.provider_error!,
    };
  if (one("connected"))
    return { tone: "success" as const, text: "Account connected. Your creator activity is now verified." };
  if (one("disconnected")) return { tone: "neutral" as const, text: "Account disconnected." };
  if (one("refreshed")) return { tone: "success" as const, text: "Connected accounts refreshed." };
  const updated = one("updated");
  if (updated && UPDATED_COPY[updated]) return { tone: "success" as const, text: UPDATED_COPY[updated]! };
  return null;
}

export default async function PassportPage({ searchParams }: PageProps<"/passport">) {
  const { passport } = await requireMember();
  const banner = notice(await searchParams);
  const connected = passport.accounts.filter((a) => a.status === "connected");
  const graph = passport.graph;

  return (
    <CreatorShell>
      <PageHeader title="Passport" description="Your verified creator-professional identity." />

      {banner ? (
        <Alert tone={banner.tone} className="mb-6">
          {banner.text}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start">
        <div className="flex flex-col gap-8 lg:sticky lg:top-10">
          <MembershipCard
            displayName={passport.displayName}
            handle={passport.handle}
            tier={passport.tier}
            memberSince={passport.memberSince}
            memberNumber={passport.memberNumber}
          />

          <ListGroup id="status" label="Creator Status" footer="Professional standing — never a credit input.">
            <ListRow
              href="/passport/status"
              label="Your Creator Status"
              detail={
                passport.status.basis === "no_signals"
                  ? "Connect an account to be considered — professional signals help"
                  : "See what each tier looks for"
              }
              accessory={<CreatorStatusBadge tier={passport.tier} />}
            />
          </ListGroup>

          <ListGroup id="verification" label="Verification">
            {passport.verifications.map((v) => (
              <ListRow
                key={v.key}
                href={v.href}
                leading={<VerificationMark state={v.state} />}
                label={v.label}
                detail={v.detail}
              />
            ))}
          </ListGroup>
        </div>

        <div className="flex flex-col gap-8">
          <ListGroup
            id="accounts"
            label="Social accounts"
            action={
              connected.length ? (
                <form action={refreshAccountsAction}>
                  <button type="submit" className="text-subhead text-gold">
                    Refresh
                  </button>
                </form>
              ) : null
            }
            footer="Connecting reads your public profile metrics with your permission. CreatorCo never posts for you."
          >
            {passport.accounts.map((a) =>
              a.status === "connected" ? (
                <ListRow
                  key={a.id}
                  href={`/passport/accounts/${a.id}`}
                  label={a.platformLabel}
                  detail={`@${a.handle}${a.sharesPlatform && a.isPrimary ? " · primary" : ""}${a.handleDiffers ? ` · declared @${a.declaredHandle}` : ""}`}
                  accessory={<StatusBadge tone="success">Connected</StatusBadge>}
                />
              ) : (
                <ListRow
                  key={a.id}
                  label={a.platformLabel}
                  detail={`@${a.handle} · self-declared`}
                  accessory={
                    a.connectable ? (
                      <Button asChild size="sm" variant="secondary">
                        <Link
                          href={`/passport/connect?platform=${a.platform}`}
                          aria-label={`Connect ${a.platformLabel}`}
                        >
                          Connect
                        </Link>
                      </Button>
                    ) : (
                      <StatusBadge>Not yet supported</StatusBadge>
                    )
                  }
                />
              ),
            )}
            {passport.addablePlatforms.map((p) => (
              <ListRow
                key={`add-${p.code}`}
                href={`/passport/connect?platform=${p.code}&additional=1`}
                label={<span className="text-gold">Add another {p.label} account</span>}
              />
            ))}
            {connected.length === 0 ? (
              <ListRow href="/passport/connect" label={<span className="text-gold">Connect an account</span>} />
            ) : passport.connectablePlatforms.some((p) => !passport.accounts.some((a) => a.platform === p.code)) ? (
              <ListRow href="/passport/connect" label={<span className="text-gold">Connect another account</span>} />
            ) : null}
          </ListGroup>

          <ListGroup
            id="signals"
            label="Professional signals"
            action={
              graph ? (
                <Link href="/passport/signals" className="text-subhead text-gold">
                  See all
                </Link>
              ) : null
            }
            footer={
              graph
                ? `About your creator business — not a credit score. Updated ${dayMonth.format(graph.computedAt)}.`
                : "Optional, with its own consent. Signals describe your creator business — they are not a credit score."
            }
          >
            {graph ? (
              SUMMARY_SIGNALS.map((key) => {
                const f = graph.features.find((x) => x.key === key);
                return (
                  <ListRow
                    key={key}
                    label={FEATURE_COPY[key].label}
                    value={formatFeatureValue(key, f?.value ?? null)}
                  />
                );
              })
            ) : passport.consents.professionalAnalytics ? (
              <ListRow
                href="/passport/connect"
                label="Connect an account to see signals"
                detail="Signals are computed from connected accounts."
              />
            ) : (
              <ListRow
                href="/passport/signals"
                label="Turn on professional signals"
                detail="See how your creator business is trending."
              />
            )}
          </ListGroup>

          <ListGroup
            id="about"
            label="About you"
            action={
              <Link href="/passport/edit/about" className="text-subhead text-gold" aria-label="Edit about you">
                Edit
              </Link>
            }
            footer="Your legal name is private to CreatorCo."
          >
            <ListRow label="Display name" value={passport.displayName} />
            <ListRow label="Legal name" value={passport.legalName} />
            <ListRow label="Location" value={passport.location ?? "—"} />
            <ListRow label="Languages" value={passport.languages.join(", ") || "—"} />
          </ListGroup>

          <ListGroup
            id="creator"
            label="Creator profile"
            action={
              <Link href="/passport/edit/profile" className="text-subhead text-gold" aria-label="Edit creator profile">
                Edit
              </Link>
            }
          >
            <ListRow label="Main handle" value={passport.handle ? `@${passport.handle}` : "—"} />
            <ListRow
              label="Categories"
              value={passport.categories.map((c) => c.label).join(", ") || "—"}
              detail={passport.categories[0] ? `Main: ${passport.categories[0].label}` : undefined}
            />
            <ListRow
              label="Creating since"
              value={passport.creatorSince ? monthYear.format(new Date(passport.creatorSince)) : "—"}
            />
          </ListGroup>

          <ListGroup
            id="business"
            label="Business"
            action={
              <Link href="/passport/edit/business" className="text-subhead text-gold" aria-label="Edit business">
                Edit
              </Link>
            }
          >
            <ListRow label="Legal form" value={passport.business.legalForm ?? "—"} />
            <ListRow label="GST" value={passport.business.gstStatus ?? "—"} />
          </ListGroup>

          <ListGroup
            id="interests"
            label="Interests"
            action={
              <Link href="/passport/edit/interests" className="text-subhead text-gold" aria-label="Edit interests">
                Edit
              </Link>
            }
          >
            <ListRow label="PR packages" value={passport.interests.prInterest ? "On" : "Off"} />
            <ListRow label="Travel and events" value={passport.interests.travelInterest ? "On" : "Off"} />
          </ListGroup>

          {passport.activity.length ? (
            <ListGroup
              id="activity"
              label="Recent activity"
              action={
                passport.moreActivity ? (
                  <Link href="/passport/activity" className="text-subhead text-gold">
                    See all
                  </Link>
                ) : undefined
              }
            >
              {passport.activity.map((a) => (
                <ListRow
                  key={a.id}
                  label={a.label}
                  value={
                    <time dateTime={a.at} className="text-subhead">
                      {dayMonth.format(new Date(a.at))}
                    </time>
                  }
                />
              ))}
            </ListGroup>
          ) : null}
        </div>
      </div>
    </CreatorShell>
  );
}
