import type { Metadata } from "next";

import { ListGroup, ListRow, MetricBlock, PageHeader } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { MIN_CELL, formatSuppressed } from "@/modules/analytics/suppression";
import { requireInsightsViewer } from "@/modules/identity";
import { PASSPORT_BANDS_VERSION } from "@/modules/public-passport/bands";
import { passportInsights } from "@/modules/public-passport/insights";

import { InsightsShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Passport insights" };

const TIER_LABEL = { public: "Everyone", unlocked: "Unlockers", hidden: "Hidden" } as const;

export default async function PassportInsightsPage() {
  const viewer = await requireInsightsViewer();
  const i = await passportInsights(getDb());
  return (
    <InsightsShell role={viewer.role}>
      <PageHeader
        eyebrow="Internal · aggregates only"
        title="Public passports"
        description={`Counts are distinct passports. Anything under ${MIN_CELL} is shown as “<${MIN_CELL}”. No slugs, names or per-creator rows. Bands ${PASSPORT_BANDS_VERSION}.`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Published", value: formatSuppressed(i.published) },
          { label: "Open to verified brands", value: formatSuppressed(i.brandsAudience) },
          { label: "Code unlocks (30 days)", value: formatSuppressed(i.unlocks30d.code) },
          { label: "Brand unlocks (30 days)", value: formatSuppressed(i.unlocks30d.brand) },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <MetricBlock label={m.label} value={m.value} />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <ListGroup id="choices" label="Creator choices (published)">
            <ListRow label="Discoverable" value={formatSuppressed(i.discoverable)} />
            <ListRow label="Listed by search engines" value={formatSuppressed(i.indexable)} />
            <ListRow label="Private work counted in totals" value={formatSuppressed(i.privateInTotals)} />
            <ListRow
              label="Code entry paused after wrong codes (30 days)"
              value={formatSuppressed(i.unlocks30d.lockout)}
            />
          </ListGroup>
          <ListGroup id="orgs" label="Brand organisations">
            <ListRow label="Verified" value={String(i.orgs.verified)} />
            <ListRow label="Pending" value={String(i.orgs.pending)} />
            <ListRow label="Suspended" value={String(i.orgs.suspended)} />
            <ListRow label="Rejected" value={String(i.orgs.rejected)} />
            <ListRow label="Open page reports" value={String(i.openReports)} />
          </ListGroup>
        </div>
        <ListGroup id="fields" label="Who sees each field" footer="Distinct published passports per choice.">
          {i.fields.map((f) => (
            <ListRow
              key={f.field}
              label={f.label}
              detail={f.allowed.map((t) => `${TIER_LABEL[t]} ${formatSuppressed(f.counts[t])}`).join(" · ")}
            />
          ))}
        </ListGroup>
      </div>
    </InsightsShell>
  );
}
