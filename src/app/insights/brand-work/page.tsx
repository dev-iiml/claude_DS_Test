import type { Metadata } from "next";

import { ListGroup, ListRow, MetricBlock, PageHeader } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { brandWorkInsights } from "@/modules/brand-work/insights";
import { CONFIRMATION_METHOD_COPY } from "@/modules/brand-work/presentation";
import { BRAND_WORK_FLAG_LABELS, type BrandWorkFlag } from "@/modules/brand-work/rules";
import { BRAND_WORK_REASONS } from "@/modules/brand-work/domain";
import { MIN_CELL, formatSuppressed } from "@/modules/analytics/suppression";
import { requireInsightsViewer } from "@/modules/identity";
import { EARN_RULES, type EarnRule } from "@/modules/rewards/rules";

import { InsightsShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Brand work insights" };

const REASON_LABELS = Object.fromEntries(BRAND_WORK_REASONS.map(([c, l]) => [c, l]));

export default async function BrandWorkInsightsPage() {
  const viewer = await requireInsightsViewer();
  const i = await brandWorkInsights(getDb());
  return (
    <InsightsShell role={viewer.role}>
      <PageHeader
        eyebrow="Internal · aggregates only"
        title="Verified brand work"
        description={`Counts are distinct creators. Anything under ${MIN_CELL} is shown as “<${MIN_CELL}”. No creator-level rows, no brand-level amounts, no documents.`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {i.funnel.map((f) => (
          <Card key={f.label}>
            <CardContent className="p-4">
              <MetricBlock label={f.label} value={formatSuppressed(f.creators)} />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <ListGroup
            id="review"
            label="Review time"
            footer={`Submitted → verified. Shown once there are at least ${MIN_CELL} reviews.`}
          >
            <ListRow label="Median" value={i.reviewHours.median === null ? "—" : `${i.reviewHours.median} h`} />
            <ListRow label="90th percentile" value={i.reviewHours.p90 === null ? "—" : `${i.reviewHours.p90} h`} />
            <ListRow label="Reversal rate" value={i.reversalRate === null ? "—" : `${i.reversalRate}%`} />
          </ListGroup>
          <ListGroup id="methods" label="Payment confirmation method">
            {i.methods.length ? (
              i.methods.map((m) => (
                <ListRow
                  key={m.method}
                  label={CONFIRMATION_METHOD_COPY[m.method as keyof typeof CONFIRMATION_METHOD_COPY]?.label ?? m.method}
                  value={formatSuppressed(m.creators)}
                />
              ))
            ) : (
              <ListRow label="None yet" />
            )}
          </ListGroup>
          <ListGroup id="reasons" label="Reasons (needs a change, not verified)">
            {i.reasons.length ? (
              i.reasons.map((r) => (
                <ListRow key={r.code} label={REASON_LABELS[r.code] ?? r.code} value={formatSuppressed(r.creators)} />
              ))
            ) : (
              <ListRow label="None yet" />
            )}
          </ListGroup>
          <ListGroup id="flags" label="Flags raised">
            {i.flags.length ? (
              i.flags.map((f) => (
                <ListRow
                  key={f.flag}
                  label={BRAND_WORK_FLAG_LABELS[f.flag as BrandWorkFlag] ?? f.flag}
                  value={formatSuppressed(f.creators)}
                />
              ))
            ) : (
              <ListRow label="None yet" />
            )}
          </ListGroup>
        </div>
        <div className="flex flex-col gap-8">
          <ListGroup
            id="industries"
            label="Top industries"
            footer="Median verified deal size is banded and shown only where enough creators contribute."
          >
            {i.industries.length ? (
              i.industries.map((x) => (
                <ListRow
                  key={x.label}
                  label={x.label}
                  detail={x.medianDealBand ? `Typical deal: ${x.medianDealBand}` : undefined}
                  value={formatSuppressed(x.creators)}
                />
              ))
            ) : (
              <ListRow label="None yet" />
            )}
          </ListGroup>
          <ListGroup id="brand-counts" label="Verified brands per creator">
            {i.verifiedBrandCount.length ? (
              i.verifiedBrandCount.map((b) => (
                <ListRow key={b.bucket} label={b.bucket} value={formatSuppressed(b.creators)} />
              ))
            ) : (
              <ListRow label="None yet" />
            )}
          </ListGroup>
          <ListGroup id="points" label="Creators reaching each milestone">
            {i.pointsByMilestone.length ? (
              i.pointsByMilestone.map((p) => (
                <ListRow
                  key={p.rule}
                  label={p.rule in EARN_RULES ? EARN_RULES[p.rule as EarnRule].label : p.rule}
                  value={formatSuppressed(p.creators)}
                />
              ))
            ) : (
              <ListRow label="None yet" />
            )}
          </ListGroup>
        </div>
      </div>
    </InsightsShell>
  );
}
