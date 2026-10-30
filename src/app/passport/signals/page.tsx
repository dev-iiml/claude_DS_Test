import Link from "next/link";
import type { Metadata } from "next";

import { BackLink, EmptyState, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FEATURE_COPY, formatFeatureValue } from "@/modules/professional-graph/presentation";
import type { FeatureKey } from "@/modules/professional-graph/engine";

import { requireMember } from "@/app/_lib/member";
import { CreatorShell } from "@/app/_components/creator-shell";

import { EnableSignalsForm } from "./enable-form";

export const metadata: Metadata = { title: "Professional signals" };

const GROUPS = [
  { key: "career", label: "Career" },
  { key: "audience", label: "Audience" },
  { key: "consistency", label: "Consistency" },
  { key: "authenticity", label: "Authenticity" },
] as const;

const SOURCE_LABEL: Record<string, string> = { verified: "Verified", declared: "Self-declared", derived: "Calculated" };
const SOURCE_TONE = { verified: "success", declared: "neutral", derived: "info" } as const;

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export default async function SignalsPage({ searchParams }: PageProps<"/passport/signals">) {
  const { passport } = await requireMember();
  const q = await searchParams;
  const { graph } = passport;
  const on = passport.consents.professionalAnalytics;

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageHeader
        title="Professional signals"
        description="How your creator business is trending, computed from your profile and connected accounts."
      />

      {q.enabled ? (
        <Alert tone="success" className="mb-6">
          Professional signals are on.
        </Alert>
      ) : null}

      <div className="max-w-2xl">
        {!on ? (
          passport.consents.analyticsDefinition ? (
            <div className="flex flex-col gap-6">
              <ListGroup id="what-you-see" label="What you’ll see">
                <ListRow label="Career" detail="How long you’ve been creating, and how steadily you post." />
                <ListRow label="Audience" detail="Reach and engagement across your connected accounts." />
                <ListRow label="Consistency" detail="Platform mix and how stable your growth has been." />
                <ListRow label="Authenticity" detail="Signs that your audience and engagement are genuine." />
              </ListGroup>
              <EnableSignalsForm definition={passport.consents.analyticsDefinition} />
            </div>
          ) : (
            <EmptyState title="Not available yet" description="Professional signals aren't available right now." />
          )
        ) : !graph ? (
          <EmptyState title="No signals yet" description="Connect an account and we'll compute your first signals." />
        ) : (
          <div className="flex flex-col gap-8">
            {GROUPS.map((g) => {
              const items = graph.features.filter((f) => FEATURE_COPY[f.key as FeatureKey]?.group === g.key);
              if (!items.length) return null;
              return (
                <ListGroup key={g.key} id={`group-${g.key}`} label={g.label}>
                  {items.map((f) => {
                    const copy = FEATURE_COPY[f.key];
                    return (
                      <ListRow
                        key={f.key}
                        label={copy.label}
                        detail={
                          <span className="flex flex-col gap-1.5">
                            <span>{copy.explain}</span>
                            <span className="flex flex-wrap gap-1.5">
                              <StatusBadge tone={SOURCE_TONE[f.source as keyof typeof SOURCE_TONE] ?? "neutral"}>
                                {SOURCE_LABEL[f.source] ?? "Calculated"}
                              </StatusBadge>
                              <StatusBadge>{`${f.confidence[0]!.toUpperCase()}${f.confidence.slice(1)} confidence`}</StatusBadge>
                            </span>
                          </span>
                        }
                        value={formatFeatureValue(f.key, f.value)}
                      />
                    );
                  })}
                </ListGroup>
              );
            })}

            <div className="flex flex-col gap-1 px-1 text-footnote leading-snug text-ink-subtle">
              <p>
                These signals describe your creator business. They are not a credit score, and they are never shared
                with a financial partner without your separate consent.
              </p>
              <p>
                Updated {dateTime.format(graph.computedAt)} · from {graph.snapshotCount} monthly snapshots
              </p>
            </div>
          </div>
        )}

        {on ? (
          <div className="mt-10">
            <Button asChild variant="ghost" className="text-danger">
              <Link href="/account/consents/professional_analytics/withdraw">Turn off professional signals</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </CreatorShell>
  );
}
