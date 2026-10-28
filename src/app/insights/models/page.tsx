import type { Metadata } from "next";

import { ListGroup, ListRow, MetricBlock, PageHeader } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { analyticsDay } from "@/modules/analytics";
import { formatInr } from "@/modules/financial-eligibility/presentation";
import { MIN_CELL, formatPct, formatSuppressed } from "@/modules/analytics/suppression";
import { requireInsightsViewer } from "@/modules/identity";
import { decisionAnalytics } from "@/modules/lending/decision-analytics";
import { UNDERWRITING_MODEL_VERSION } from "@/modules/underwriting/model";
import { modelAnalytics } from "@/modules/underwriting/model-analytics";

import { InsightsShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Model analytics" };

const MODEL_LABEL: Record<string, string> = { traditional: "Traditional", creator_enhanced: "Creator-Enhanced" };
const COMPONENT_LABEL: Record<string, string> = {
  financial_strength: "Financial Strength",
  income_stability: "Income Stability",
  creator_business_stability: "Creator Business Stability",
  revenue_diversification: "Revenue Diversification",
  professional_longevity: "Professional Longevity",
  audience_authenticity: "Audience Authenticity",
  brand_recurrence: "Brand Recurrence",
};

export default async function ModelAnalyticsPage() {
  const viewer = await requireInsightsViewer();
  const db = getDb();
  // Analysts (aggregate-only role) see figures as of the start of today (India time), with the average amount
  // difference rounded to ₹1,000, so a single new run can't be read off by comparing refreshes. Risk roles see live.
  const live = viewer.role !== "analyst";
  const asOf = live ? undefined : new Date(`${analyticsDay(new Date())}T00:00:00+05:30`);
  const [m, decisions] = await Promise.all([
    modelAnalytics(db, { asOf, roundDeltaTo: live ? 1 : 1_000 }),
    decisionAnalytics(db, { asOf }),
  ]);
  const delta = m.paired.avgLimitDelta;

  return (
    <InsightsShell role={viewer.role}>
      <PageHeader
        eyebrow={`Current model ${UNDERWRITING_MODEL_VERSION} · hypothesis`}
        title="Model analytics"
        description={`${live ? "Live." : "As of the start of today (India time)."} Traditional vs Creator-Enhanced over the same frozen inputs, fraud and partner-lender decision rates. Aggregates only; counts under ${MIN_CELL} are hidden. Differences are hypotheses until lender repayment outcomes validate them — nothing here shows lower default risk.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <MetricBlock label="Recommendation runs" value={formatSuppressed(m.runs)} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <MetricBlock
              label="Avg recommended-amount difference"
              value={delta === null ? "—" : `${delta >= 0 ? "+" : "−"}${formatInr(Math.abs(delta))}`}
              hint="Creator-Enhanced minus Traditional, where both recommend an amount"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <MetricBlock
              label="Eligible only with creator signals"
              value={formatSuppressed(m.paired.enhancedOnly)}
              hint={`Reverse: ${formatSuppressed(m.paired.traditionalOnly)}`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <MetricBlock
              label="Fraud flag rate"
              value={formatPct(m.fraud.flaggedPct)}
              hint={`Sent to review: ${formatPct(m.fraud.reviewPct)}`}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
        <ListGroup id="eligibility" label="Eligibility rate by model" footer="Share of runs per outcome.">
          {m.byModel.map((r) => (
            <ListRow
              key={r.model}
              label={MODEL_LABEL[r.model] ?? r.model}
              detail={`Refer ${formatPct(r.referPct)} · Not recommended ${formatPct(r.notRecommendedPct)} · ${formatSuppressed(r.runs)} runs`}
              value={`${formatPct(r.recommendPct)} recommend`}
            />
          ))}
          {m.byModel.length === 0 ? <ListRow label="No runs yet" /> : null}
        </ListGroup>

        <ListGroup
          id="paired"
          label="Recommended amount, paired"
          footer="Per run, Creator-Enhanced compared with Traditional (no amount counts as zero)."
        >
          <ListRow label="Higher with creator signals" value={formatSuppressed(m.paired.higher)} />
          <ListRow label="Same" value={formatSuppressed(m.paired.same)} />
          <ListRow label="Lower with creator signals" value={formatSuppressed(m.paired.lower)} />
        </ListGroup>

        <ListGroup
          id="missingness"
          label="Feature missingness"
          footer="Share of runs where a component had no input (missing inputs are never guessed)."
        >
          {m.missingness.length ? (
            m.missingness.map((r) => (
              <ListRow
                key={`${r.model}-${r.component}`}
                label={COMPONENT_LABEL[r.component] ?? r.component}
                detail={MODEL_LABEL[r.model] ?? r.model}
                value={formatPct(r.missingPct)}
              />
            ))
          ) : (
            <ListRow label="No runs yet" />
          )}
        </ListGroup>

        <div className="flex flex-col gap-8">
          <ListGroup id="versions" label="Model versions" footer="Runs per underwriting model version.">
            {m.versions.length ? (
              m.versions.map((v) => <ListRow key={v.version} label={v.version} value={formatSuppressed(v.runs)} />)
            ) : (
              <ListRow label="No runs yet" />
            )}
          </ListGroup>

          <ListGroup
            id="decisions"
            label="Partner-lender decisions"
            footer="The lender's own decisions (approve / modify / decline) and creators' answers to offers. Simulated = the pilot's simulated lender."
          >
            {decisions.map((d) => (
              <ListRow
                key={d.lender}
                label={d.lender === "simulated" ? "Simulated lender" : "Partner lenders"}
                detail={`Approve ${formatPct(d.approvedPct)} · Modify ${formatPct(d.modifiedPct)} · Decline ${formatPct(d.declinedPct)}${
                  d.overriddenPct !== null ? ` · Staff override ${formatPct(d.overriddenPct)}` : ""
                } · Offers accepted ${formatPct(d.acceptedPct)} of ${formatSuppressed(d.offersAnswered)}`}
                value={`${formatSuppressed(d.decisions)} decisions`}
              />
            ))}
          </ListGroup>
        </div>
      </div>
    </InsightsShell>
  );
}
